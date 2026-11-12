/**
 * CharacterSystem.ts
 *
 * People at their desks. setPeople([{ personId, deskId, name, department,
 * character: { url, rig, height } | null }]) seats each person on their
 * desk's chair (play/people.deskSeats), or stands them at a desk with no
 * chair. Used by LayoutEngine (viewer, embed) and Workplace Studio.
 *
 * - Everyone is a SIMPLE FIGURE first: one mesh per pose (seated / standing)
 *   with a thin instance per person, so hundreds of people cost two draw calls.
 * - The nearest people on the current floor (play/people.chooseFullCharacters:
 *   at most 12, within ~15 m) become FULL CHARACTERS once their file has
 *   loaded: each file loads once per scene (at most 3 downloads at once) and
 *   each person gets a copy with its own skeleton (geometry and textures
 *   shared). Bones are found by name (Mixamo, or Unreal-style for rig 'ue':
 *   play/people.canonicalBoneName) and aimed into a seated or standing pose
 *   (play/people SEATED_POSE / STANDING_POSE); no animation file is needed.
 *   The nearest few breathe slowly. A file that fails keeps the simple figure.
 * - v0.16.0: a character with clips (its clip set or its own file: the shared
 *   ClipLibrary) is posed by its clip instead: 'Type' at a desk with a keyboard,
 *   laptop or monitor, 'Sit' at another, 'Idle' standing (play/people workClip).
 *   The nearest MAX_ANIMATED of them play it (an Animator each, starting at
 *   their own point of the cycle); the others hold its first frame. The hips go
 *   onto the seat in that pose, so the clip's own sitting height counts.
 * - v0.16.0, many people: the simple figures are grey (further than the full
 *   characters, or while a file loads), and a character file nobody near uses
 *   is unloaded after UNLOAD_AFTER_MS (loaded again when someone is near).
 *   Files asked for through loadFile() (your character, the walk clip, clip
 *   sets) stay.
 * - A person shows while their desk does (FloorSystem: per floor) and once it
 *   is built (progressive loading). Nothing here is pickable: a pick goes to
 *   the desk or chair, and pickPerson() finds the person from it.
 * - Nothing at all with the simple look (quality 'low'): setEnabled(false).
 *
 * Reads the layout with the store's (v1) field names, like the other systems.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';

import {
  deskSeats, seatPose, personNear, chooseFullCharacters, canonicalBoneName, boneKey, SEATED_POSE, STANDING_POSE,
  SEAT_HEIGHT, HIPS_ABOVE_SEAT, HIPS_BEHIND_SEAT, breathing, phaseOf, MAX_FULL_CHARACTERS, MAX_ANIMATED, workClip,
} from '../../play/people';
import { levelForY } from '../../play/building';
import { cleanClothing, outfitLook, partName } from '../../play/outfit';
import { loadGlbContainer } from '../../utils/modelLoader';
import type { LayoutRecords } from './RoomSystem';
import { ClipLibrary, Animator, holdClip } from './ClipLibrary';
import type { BakedClip } from './ClipLibrary';

// ── Types ────────────────────────────────────────────────────────────────

export type CharacterRig = 'mixamo' | 'ue';

/** A character file: where it is, its bone names, how tall the person is (m). */
export interface CharacterFile {
  url: string;
  rig?: CharacterRig;
  height?: number;
  /** v0.16.0 (manifest v2): 'female' | 'male', which clip set fits. */
  gender?: 'female' | 'male';
  /** v0.16.0: 'rocketbox' = the file has the Rocketbox outfit parts (play/outfit.js shows / tints them). */
  outfit?: 'rocketbox';
  /** v0.16.0: the url of the character's clip set (an animation-only .glb shared by many characters). */
  clips?: string;
}

export interface Person {
  personId: string;
  deskId: string;
  name?: string;
  department?: string;
  /** null / missing: the neutral simple figure. */
  character?: CharacterFile | null;
  /** Whether they chose a character in AHDUS (default: whether `character` is given). The viewer's card offers
   *  "Choose your character" to the signed-in person (LayoutViewer `player`) when they haven't. */
  characterChosen?: boolean;
  /** v0.16.0: what they wear (AHDUS's Wardrobe: play/outfit.js cleanClothing); only a Rocketbox outfit file changes. */
  clothing?: Clothing | null;
}

/** What a person chose in the Wardrobe (play/outfit.js). */
export interface Clothing {
  schemaVersion?: number;
  pantsColor?: 'black' | 'blue';
  upperBody?: 'shirt' | 'tshirt' | null;
  upperColor?: string | null;
}

/** A person where they are drawn (world space; y = the floor under them). */
export interface PlacedPerson extends Person {
  floor: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  seated: boolean;
  chairId: string | null;
  seatHeight: number;
}

export interface CharacterSystemOptions {
  /** The layout (store state): objects, floors, currentFloor. */
  getLayout: () => Pick<LayoutRecords, 'objects' | 'floors'> & { currentFloor?: number };
  /** An item's mesh (its root): a person shows only while their desk's mesh is built and shown. */
  getObjectMesh: (objectId: string) => { isEnabled(): boolean; isDisposed(): boolean } | null;
  /** At most this many full characters (default 12). */
  maxFull?: number;
  /** v0.16.0: at most this many of them (the nearest) play their clip; the rest hold its first frame (default 8). */
  maxAnimated?: number;
  /** At most this many character files downloading at once (default 3). */
  maxDownloads?: number;
  /** v0.16.0: a character file nobody near uses is unloaded after this long (ms; default UNLOAD_AFTER_MS). */
  unloadAfterMs?: number;
  /** Load a character file (tests); default: the glTF loader. */
  loadFile?: (url: string, scene: Scene) => Promise<AssetContainer>;
}

/** A character (or walk clip) file, loaded once per scene. */
export interface LoadedFile {
  container: AssetContainer;
  /** Rest pose, measured on the first copy: height and lowest point (file units). */
  rest?: { height: number; minY: number };
  /** v0.16.0: the file's materials tinted for an outfit ("material|#hex" → its copy), shared by its copies. */
  tinted?: Map<string, Material>;
}

interface FullCharacter {
  url: string;
  /** What they wear, as made (cleanClothing as JSON): other clothing = made again. */
  wears: string;
  root: TransformNode;
  meshes: AbstractMesh[];
  skeletons: Skeleton[];
  /** Breathing: the spine's posed rotation and the axis it sways about (its parent's frame). */
  spine: { node: TransformNode; base: Quaternion; axis: Vector3 } | null;
  phase: number;
  /** v0.16.0: every bone by key (the clips' targets). */
  bones: Map<string, TransformNode>;
  /** v0.16.0: the clip that poses them (Type / Sit / Idle), null: the procedural pose. */
  clip: BakedClip | null;
  /** v0.16.0: playing it (the nearest few); null: holding its first frame. */
  animator: Animator | null;
}

/** The clips a person at a desk may play (play/people workClip). */
const WORK_CLIPS = ['Type', 'Sit', 'Idle'];

/** How often who is a full character is decided again (ms). */
const CHOOSE_EVERY_MS = 300;
/** This many of the full characters (the nearest) breathe. */
const BREATHING = 3;
/** The simple figure is drawn for a person this tall (m). */
const FIGURE_HEIGHT = 1.75;
/** v0.16.0: the simple figures' grey (far away, or while a character file loads). */
export const FIGURE_GREY = new Color3(0.62, 0.64, 0.67);
/** v0.16.0: a character file nobody near uses is unloaded after this long (ms). */
export const UNLOAD_AFTER_MS = 30_000;

// ── CharacterSystem ──────────────────────────────────────────────────────

export class CharacterSystem {
  private scene: Scene;
  private options: CharacterSystemOptions;
  private maxFull: number;
  private maxAnimated: number;
  private maxDownloads: number;
  /** v0.16.0: the work clips baked per character file (the library's key): ready, or being baked. */
  private workClips = new Map<string, Map<string, BakedClip> | 'baking'>();
  private lastFrame = -1;
  /** v0.16.0: when each character file was last used by someone near (ms), for unloading. */
  private lastUsed = new Map<string, number>();
  /** Files asked for through loadFile() (your character, the walk clip, clip sets): never unloaded. */
  private pinned = new Set<string>();
  /** Files whose clips are being baked (url → how many bakes): not unloaded meanwhile. */
  private bakingFiles = new Map<string, number>();
  private unloadAfter: number;
  /** How many character files were unloaded (tests). */
  unloads = 0;

  private people: Person[] = [];
  private placed: PlacedPerson[] = [];
  private placedFor: { objects: unknown; floors: unknown; people: Person[] } | null = null;
  private enabled = true;

  // simple figures: one mesh per pose, a thin instance per person shown
  private figures: { seated: Mesh; standing: Mesh } | null = null;
  private figureMaterial: StandardMaterial | null = null;
  private figureKey: string | null = null; // who the thin instances show (null: draw again)

  // full characters
  private files = new Map<string, Promise<LoadedFile> | LoadedFile | 'failed'>();
  /** The person walking through (LayoutEngine): their seated figure isn't drawn meanwhile. */
  private hiddenPerson: string | null = null;
  private queue: string[] = [];
  /** loadFile calls for a file still in the queue: settled when its download starts and ends. */
  private waiting = new Map<string, { resolve: (f: LoadedFile) => void; reject: (e: Error) => void }[]>();
  private downloading = 0;
  private full = new Map<string, FullCharacter>();
  private chosen: string[] = [];
  private lastChoice = -Infinity;

  private observer: Observer<Scene> | null;
  private disposed = false;
  /** v0.16.0: the shared animation library (clips baked once per character file), with this load-once queue. */
  readonly clipLibrary: ClipLibrary;

  constructor(scene: Scene, options: CharacterSystemOptions) {
    this.scene = scene;
    this.options = options;
    this.maxFull = options.maxFull ?? MAX_FULL_CHARACTERS;
    this.maxAnimated = options.maxAnimated ?? MAX_ANIMATED;
    this.maxDownloads = options.maxDownloads ?? 3;
    this.unloadAfter = options.unloadAfterMs ?? UNLOAD_AFTER_MS;
    this.observer = scene.onBeforeRenderObservable.add(() => this.update());
    this.clipLibrary = new ClipLibrary(scene, (url) => this.loadFile(url));
  }

  // ── Public ─────────────────────────────────────────────────────────────

  /**
   * Who sits where (replaces the list before). A person whose desk isn't in
   * the layout isn't drawn; one desk = one person (the first one listed).
   */
  setPeople(people: Person[]): void {
    const seen = new Set<string>();
    this.people = (people ?? []).filter((p) => {
      if (!p || typeof p.personId !== 'string' || typeof p.deskId !== 'string' || seen.has(p.deskId)) return false;
      seen.add(p.deskId);
      return true;
    }).map((p) => ({ ...p, character: validCharacter(p.character), clothing: cleanClothing(p.clothing) }));
    this.placedFor = null;
    this.lastChoice = -Infinity;
    this.update();
  }

  /** Everyone placed at a desk of the current layout. */
  getPlaced(): PlacedPerson[] {
    this.place();
    return this.placed;
  }

  /** The person at this desk, or on this chair. */
  personForObject(objectId: string | null | undefined): PlacedPerson | null {
    if (!objectId) return null;
    return this.getPlaced().find((p) => p.deskId === objectId || p.chairId === objectId) ?? null;
  }

  /** The person nearest a point on a floor, within `radius` m (horizontally). */
  personAt(point: { x: number; z: number }, floor: number, radius = 0.6): PlacedPerson | null {
    return personNear(this.getPlaced().filter((p) => this.isShown(p)), point, floor, radius) as PlacedPerson | null;
  }

  /**
   * The person under a screen point (CSS px in the canvas): pointing at their
   * desk, their chair or right next to where they are.
   */
  pickPerson(x: number, y: number): PlacedPerson | null {
    if (!this.enabled || this.people.length === 0) return null;
    const objectOf = (m: AbstractMesh | null) => m?.metadata?.objectId ?? m?.parent?.metadata?.objectId ?? null;
    const hit = this.scene.pick(x, y, (m) => m.isPickable && m.isEnabled() && m.isVisible && !m.metadata?.pickPane);
    if (!hit?.hit) return null;
    const byObject = this.personForObject(objectOf(hit.pickedMesh));
    if (byObject && this.isShown(byObject)) return byObject;
    const point = hit.pickedPoint;
    if (!point) return null;
    return this.personAt(point, levelForY(this.options.getLayout().floors, point.y, 0.05));
  }

  /** v0.16.0: how many full characters play their clip now (the rest hold it). */
  get animatedCount(): number {
    let n = 0;
    for (const f of this.full.values()) if (f.animator && f.root.isEnabled()) n++;
    return n;
  }

  /** v0.16.0: what a full character does (tests): its clip, whether it plays. Null: not a full character. */
  fullState(personId: string): { clip: string | null; playing: boolean; root: TransformNode; bones: Map<string, TransformNode> } | null {
    const f = this.full.get(personId);
    return f ? { clip: f.clip?.name ?? null, playing: !!f.animator, root: f.root, bones: f.bones } : null;
  }

  /** v0.16.0: the character files loaded now (tests). */
  get loadedFiles(): string[] {
    return [...this.files].filter(([, f]) => f !== 'failed' && !(f instanceof Promise)).map(([url]) => url);
  }

  /** How many people are drawn as full characters now. */
  get fullCount(): number {
    let n = 0;
    for (const f of this.full.values()) if (f.root.isEnabled()) n++;
    return n;
  }

  /** Resolves when no character file is loading (tests). */
  async whenSettled(): Promise<void> {
    for (;;) {
      const loading = [...this.files.values()].filter((f): f is Promise<LoadedFile> => f instanceof Promise);
      if (!loading.length && !this.queue.length) return;
      await Promise.allSettled(loading);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /**
   * A file through the same load-once queue as the people's (the player's
   * character, the walk clip): rejects if it can't be loaded. While other
   * files take every download slot it waits its turn, ahead of the people's.
   */
  loadFile(url: string): Promise<LoadedFile> {
    if (this.disposed) return Promise.reject(new Error('The characters were closed'));
    this.pinned.add(url);
    const file = this.fileFor(url);
    if (file === 'failed') return Promise.reject(new Error(`could not load ${url}`));
    if (file instanceof Promise) return file;
    if (file) return Promise.resolve(file);
    // Queued (every slot busy): first in the queue, settled when its download is done
    this.queue = [url, ...this.queue.filter((u) => u !== url)];
    return new Promise((resolve, reject) => {
      this.waiting.set(url, [...(this.waiting.get(url) ?? []), { resolve, reject }]);
    });
  }

  /** Don't draw this person at their desk (they are walking through); null: everyone. */
  setHiddenPerson(personId: string | null): void {
    if (this.hiddenPerson === personId) return;
    this.hiddenPerson = personId;
    this.figureKey = null;
    this.lastChoice = -Infinity;
    this.update();
  }

  /** Show people (true) or nothing at all (false: the simple look). */
  setEnabled(on: boolean): void {
    if (this.enabled === !!on) return;
    this.enabled = !!on;
    if (!on) {
      for (const id of [...this.full.keys()]) this.removeFull(id);
      this.clipLibrary.dispose();
      this.workClips.clear();
      this.chosen = [];
    }
    this.figureKey = null;
    this.lastChoice = -Infinity;
    this.update();
  }

  /** Bring everything up to date (called before every frame). */
  update(): void {
    if (this.disposed || this.scene.isDisposed) return;
    this.place();
    const now = performance.now();
    if (now - this.lastChoice >= CHOOSE_EVERY_MS) {
      this.lastChoice = now;
      this.choose();
    }
    this.syncFigures();
    const dt = this.lastFrame < 0 ? 0 : Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.animate(dt);
    this.breathe(now / 1000);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.observer = null;
    for (const id of [...this.full.keys()]) this.removeFull(id);
    this.figures?.seated.dispose();
    this.figures?.standing.dispose();
    this.figureMaterial?.dispose();
    for (const f of this.files.values()) if (f !== 'failed' && !(f instanceof Promise)) disposeFile(f);
    this.files.clear();
    this.queue = [];
    for (const list of this.waiting.values()) for (const w of list) w.reject(new Error('The characters were closed'));
    this.waiting.clear();
  }

  // ── Placing ────────────────────────────────────────────────────────────

  /** Seat everyone again when the people, the items or the floors changed. */
  private place(): void {
    const { objects, floors } = this.options.getLayout();
    const p = this.placedFor;
    if (p && p.objects === objects && p.floors === floors && p.people === this.people) return;
    this.placedFor = { objects, floors, people: this.people };
    const seats = deskSeats(objects);
    const before = new Map(this.placed.map((x) => [x.personId, x]));
    this.placed = [];
    for (const person of this.people) {
      const pose = seatPose(person.deskId, objects, floors, seats);
      if (pose) this.placed.push({ ...person, ...pose });
    }
    // a full character whose seat, file or desk changed is made again
    for (const [id, f] of this.full) {
      const now = this.placed.find((x) => x.personId === id);
      const was = before.get(id);
      if (!now || !was || now.character?.url !== f.url || wearsOf(now) !== f.wears || !samePlace(now, was)) this.removeFull(id);
    }
    this.figureKey = null;
  }

  private isShown(p: PlacedPerson): boolean {
    if (!this.enabled || p.personId === this.hiddenPerson) return false;
    const desk = this.options.getObjectMesh(p.deskId);
    return !!desk && !desk.isDisposed() && desk.isEnabled();
  }

  // ── Full characters ────────────────────────────────────────────────────

  private choose(): void {
    if (!this.enabled) return;
    const camera = this.scene.activeCamera;
    if (!camera) return;
    const eye = camera.globalPosition;
    const floor = this.options.getLayout().currentFloor ?? 0;
    const shown = this.placed.filter((p) => this.isShown(p) && this.files.get(p.character?.url ?? '') !== 'failed');
    // v0.16.0: the point looked at (from above the orbit's target; walking a point ahead of the camera)
    const looked = (camera as { getTarget?: () => { x: number; y: number; z: number } }).getTarget?.() ?? null;
    this.chosen = chooseFullCharacters(shown, eye, floor, { max: this.maxFull, current: this.full.keys(), focus: looked });
    const wanted = new Set(this.chosen);
    for (const id of [...this.full.keys()]) if (!wanted.has(id)) this.removeFull(id);
    for (const id of this.chosen) {
      if (this.full.has(id)) continue;
      const person = this.placed.find((p) => p.personId === id)!;
      const file = this.fileFor(person.character!.url);
      if (file && file !== 'failed' && !(file instanceof Promise)) this.makeFull(person, file);
    }
    this.unloadUnused(performance.now());
  }

  /** v0.16.0: unload the character files nobody near has used for unloadAfter ms. */
  private unloadUnused(now: number): void {
    const used = new Set<string>();
    for (const f of this.full.values()) used.add(f.url);
    for (const id of this.chosen) {
      const url = this.placed.find((p) => p.personId === id)?.character?.url;
      if (url) used.add(url);
    }
    for (const url of used) this.lastUsed.set(url, now);
    for (const [url, file] of [...this.files]) {
      if (file === 'failed' || file instanceof Promise || used.has(url) || this.pinned.has(url) || this.bakingFiles.has(url)) continue;
      const last = this.lastUsed.get(url);
      if (last === undefined) {
        this.lastUsed.set(url, now);
        continue;
      }
      if (now - last < this.unloadAfter) continue;
      disposeFile(file);
      this.files.delete(url);
      this.lastUsed.delete(url);
      this.unloads++;
    }
  }

  /** The file, loaded or loading; queued (at most maxDownloads at once) if not asked for yet. */
  private fileFor(url: string): LoadedFile | Promise<LoadedFile> | 'failed' | null {
    const known = this.files.get(url);
    if (known) return known;
    if (!this.queue.includes(url)) this.queue.push(url);
    this.pump();
    return this.files.get(url) ?? null;
  }

  private pump(): void {
    while (this.downloading < this.maxDownloads && this.queue.length) {
      const url = this.queue.shift()!;
      this.downloading++;
      const load = (this.options.loadFile ?? loadGlbContainer)(url, this.scene);
      const loading = load.then((container) => {
        const loaded: LoadedFile = { container };
        if (this.disposed) container.dispose();
        else this.files.set(url, loaded);
        return loaded;
      }, (err) => {
        console.warn(`[characters] could not load ${url}: the simple figure stays`, err?.message ?? err);
        this.files.set(url, 'failed');
        throw err;
      }).finally(() => {
        this.downloading--;
        if (this.disposed) return;
        this.pump();
        this.lastChoice = -Infinity; // swap them in on the next frame
      });
      loading.catch(() => {});
      this.files.set(url, loading);
      const waiting = this.waiting.get(url);
      this.waiting.delete(url);
      for (const w of waiting ?? []) loading.then(w.resolve, w.reject);
    }
  }

  private makeFull(person: PlacedPerson, file: LoadedFile): void {
    const { root, meshes, skeletons, bones, allBones } = copyCharacter(this.scene, file, person.character!, `person_${person.personId}`,
      { personId: person.personId }, person.clothing);
    root.rotation.y = person.yaw;
    root.position.set(person.x, person.y, person.z);
    refreshTree(root);

    // v0.16.0: the clip's pose (its first frame) where the character has clips, else the procedural pose
    const clip = this.workClipFor(person, file);
    if (clip) holdClip(clip, allBones, 0);
    else poseBones(root, bones, person.seated ? SEATED_POSE : STANDING_POSE);

    // seated: the hips onto the seat, a little behind its centre
    const hips = bones.get('Hips');
    if (person.seated && hips) {
      refreshTree(root);
      const size = (person.character?.height ?? FIGURE_HEIGHT) / FIGURE_HEIGHT;
      const back = HIPS_BEHIND_SEAT * size;
      const target = new Vector3(
        person.x - Math.sin(person.yaw) * back,
        person.y + person.seatHeight + HIPS_ABOVE_SEAT * size,
        person.z - Math.cos(person.yaw) * back,
      );
      root.position.addInPlace(target.subtract(hips.getAbsolutePosition()));
    }
    refreshTree(root);
    for (const m of meshes) m.refreshBoundingInfo({ applySkeleton: true });

    const spineNode = bones.get('Spine') ?? null;
    let spine: FullCharacter['spine'] = null;
    if (spineNode?.parent) {
      const inv = (spineNode.parent as TransformNode).getWorldMatrix().clone().invert();
      const side = Vector3.TransformNormal(Vector3.TransformNormal(Vector3.Right(), root.getWorldMatrix()), inv).normalize();
      spine = { node: spineNode, base: rotationOf(spineNode).clone(), axis: side };
    }
    this.full.set(person.personId, {
      url: person.character!.url, wears: wearsOf(person), root, meshes, skeletons, spine, phase: phaseOf(person.personId),
      bones: allBones, clip, animator: null,
    });
    this.figureKey = null;
  }

  private removeFull(personId: string): void {
    const f = this.full.get(personId);
    if (!f) return;
    this.full.delete(personId);
    f.animator?.dispose();
    // materials and textures belong to the file's container (shared): keep them
    f.root.dispose(false, false);
    for (const s of f.skeletons) s.dispose();
    this.figureKey = null;
  }

  /**
   * v0.16.0: the clip this person is posed by, once it is baked (null meanwhile, or none: the procedural pose).
   * The first ask starts the baking; when it is done the people of that file are made again in their clip's pose.
   */
  private workClipFor(person: PlacedPerson, file: LoadedFile): BakedClip | null {
    const character = person.character!;
    const key = [ClipLibrary.sourceOf(character), character.url, character.height ?? '', character.rig ?? 'mixamo'].join('|');
    const known = this.workClips.get(key);
    if (known === undefined) {
      this.workClips.set(key, 'baking');
      this.bakingFiles.set(character.url, (this.bakingFiles.get(character.url) ?? 0) + 1);
      this.clipLibrary.clips(character, file, WORK_CLIPS).finally(() => {
        const n = (this.bakingFiles.get(character.url) ?? 1) - 1;
        if (n > 0) this.bakingFiles.set(character.url, n);
        else this.bakingFiles.delete(character.url);
      }).then((clips) => {
        if (this.disposed || this.workClips.get(key) !== 'baking') return;
        this.workClips.set(key, clips);
        if (!clips.size) return;
        // those already drawn in the procedural pose: made again in the clip's
        for (const [id, f] of [...this.full]) {
          const p = this.placed.find((x) => x.personId === id);
          if (!f.clip && p?.character && [ClipLibrary.sourceOf(p.character), p.character.url, p.character.height ?? '',
            p.character.rig ?? 'mixamo'].join('|') === key) this.removeFull(id);
        }
        this.lastChoice = -Infinity;
      });
      return null;
    }
    if (known === 'baking') return null;
    const want = workClip(person, this.options.getLayout().objects);
    return known.get(want) ?? (want === 'Type' ? known.get('Sit') : undefined) ?? null;
  }

  /** v0.16.0: the nearest maxAnimated full characters play their clip, the others hold its first frame. */
  private animate(dt: number): void {
    const wanted = new Set(this.chosen.slice(0, this.maxAnimated));
    for (const [id, f] of this.full) {
      if (!f.clip) continue;
      const play = wanted.has(id) && f.root.isEnabled();
      if (play && !f.animator) {
        const animator = new Animator(this.scene, f.bones, `person_${id}`);
        animator.add(f.clip);
        animator.play(f.clip.name, { fade: 0.3, at: f.phase / (Math.PI * 2) });
        f.animator = animator;
      } else if (!play && f.animator) {
        f.animator.dispose();
        f.animator = null;
        holdClip(f.clip, f.bones, 0);
      }
      f.animator?.update(dt);
    }
  }

  private breathe(t: number): void {
    const near = this.chosen.slice(0, BREATHING);
    for (const id of near) {
      const f = this.full.get(id);
      if (!f?.spine || !f.root.isEnabled() || f.animator) continue;
      const sway = Quaternion.RotationAxis(f.spine.axis, breathing(t, f.phase));
      f.spine.node.rotationQuaternion = sway.multiply(f.spine.base);
    }
  }

  // ── Simple figures ─────────────────────────────────────────────────────

  /** One thin instance per person shown who isn't a full character; full characters follow their desk. */
  private syncFigures(): void {
    const shown = this.placed.filter((p) => this.isShown(p));
    const shownIds = new Set(shown.map((p) => p.personId));
    for (const [id, f] of this.full) f.root.setEnabled(shownIds.has(id));
    const simple = shown.filter((p) => !this.full.has(p.personId));
    const key = simple.map((p) => p.personId).join('|');
    if (key === this.figureKey) return;
    this.figureKey = key;
    if (!simple.length && !this.figures) return;
    const figures = this.ensureFigures();
    for (const seated of [true, false]) {
      const mesh = seated ? figures.seated : figures.standing;
      const these = simple.filter((p) => p.seated === seated);
      if (!these.length) {
        mesh.thinInstanceCount = 0;
        mesh.setEnabled(false);
        continue;
      }
      const data = new Float32Array(these.length * 16);
      these.forEach((p, i) => {
        const s = (p.character?.height ?? FIGURE_HEIGHT) / FIGURE_HEIGHT;
        const lift = seated ? p.seatHeight - SEAT_HEIGHT : 0;
        Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationAxis(Vector3.Up(), p.yaw), new Vector3(p.x, p.y + lift, p.z))
          .copyToArray(data, i * 16);
      });
      mesh.thinInstanceSetBuffer('matrix', data, 16, true);
      mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.setEnabled(true);
    }
  }

  private ensureFigures(): { seated: Mesh; standing: Mesh } {
    if (this.figures) return this.figures;
    const mat = new StandardMaterial('person_figure', this.scene);
    mat.diffuseColor = FIGURE_GREY.clone();
    mat.specularColor = new Color3(0.08, 0.08, 0.08);
    this.figureMaterial = mat;
    this.figures = { seated: buildFigure(this.scene, true, mat), standing: buildFigure(this.scene, false, mat) };
    return this.figures;
  }
}

// ── A copy of a character file (people at desks, the player walking through) ──

export interface CharacterCopy {
  /** At the feet, facing +Z; move and turn this one. */
  root: TransformNode;
  meshes: AbstractMesh[];
  skeletons: Skeleton[];
  /** Bones by their Mixamo name (Hips, LeftUpLeg, …), whatever the rig. */
  bones: Map<string, TransformNode>;
  /** v0.16.0: EVERY bone by play/people boneKey (fingers, face bones too): what clips are retargeted onto. */
  allBones: Map<string, TransformNode>;
}

/**
 * Puts a loaded file back in its rest pose and stops its animations: a copy
 * (instantiateModelsToScene) starts in the pose the file's nodes are in, and
 * an animation the glTF loader started moves them every frame. Our loader
 * starts none (modelLoader GLB_LOAD_OPTIONS); this covers files loaded otherwise.
 */
export function restContainer(container: AssetContainer): void {
  for (const group of container.animationGroups) {
    if (group.isStarted) group.reset();
    group.stop();
  }
}

/**
 * A copy of the file with its own skeleton (geometry and materials shared),
 * scaled to the person's height, its feet at `root`'s origin, in its rest pose.
 * Its meshes aren't pickable and carry `metadata` (e.g. { personId }).
 */
export function copyCharacter(scene: Scene, file: LoadedFile, character: CharacterFile, name: string,
  metadata: Record<string, unknown> = {}, clothing: Clothing | null = null): CharacterCopy {
  const rig = character.rig ?? 'mixamo';
  restContainer(file.container);
  const copy = file.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  for (const group of copy.animationGroups) { group.stop(); group.dispose(); }
  const root = new TransformNode(name, scene);
  const fit = new TransformNode(`${name}_fit`, scene);
  fit.parent = root;
  for (const n of copy.rootNodes) n.parent = fit;
  const meshes = fit.getChildMeshes(false);
  for (const m of meshes) {
    m.isPickable = false;
    m.checkCollisions = false;
    m.metadata = { ...(m.metadata ?? {}), ...metadata };
  }

  const bones = new Map<string, TransformNode>();
  const allBones = new Map<string, TransformNode>();
  for (const skeleton of copy.skeletons) {
    for (const bone of skeleton.bones) {
      const node = bone.getTransformNode();
      if (!node) continue;
      const key = canonicalBoneName(bone.name, rig);
      if (key && !bones.has(key)) bones.set(key, node);
      const any = boneKey(bone.name, rig);
      if (any && !allBones.has(any)) allBones.set(any, node);
    }
  }

  // the person's height: the file's rest pose, measured once (every part, whatever they wear)
  refreshTree(root);
  if (!file.rest) file.rest = measure(meshes);
  wearOutfit(file, character, meshes, clothing);
  const scale = (character.height ?? FIGURE_HEIGHT) / file.rest.height;
  fit.scaling.setAll(scale);
  fit.position.y = -file.rest.minY * scale;
  refreshTree(root);
  return { root, meshes, skeletons: copy.skeletons, bones, allBones };
}

/** Aim the bones into a pose (play/people SEATED_POSE, STANDING_POSE), parents first. */
export function poseBones(root: TransformNode, bones: Map<string, TransformNode>, pose: [string, string, number[]][]): void {
  for (const [bone, toward, dir] of pose) aimBone(root, bones.get(bone), bones.get(toward), dir);
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** A character file as the systems use it (rig and height checked), or null: the simple figure. */
export function validCharacter(c: CharacterFile | null | undefined): CharacterFile | null {
  if (!c || typeof c.url !== 'string' || !c.url) return null;
  const height = Number(c.height);
  const out: CharacterFile = {
    url: c.url,
    rig: c.rig === 'ue' ? 'ue' : 'mixamo',
    height: Number.isFinite(height) && height >= 1 && height <= 2.3 ? height : FIGURE_HEIGHT,
  };
  if (c.gender === 'female' || c.gender === 'male') out.gender = c.gender;
  if (c.outfit === 'rocketbox') out.outfit = c.outfit;
  if (typeof c.clips === 'string' && c.clips) out.clips = c.clips;
  return out;
}

/** What a person wears, as a key (a full character is made again when it changes). */
function wearsOf(p: Person): string {
  return JSON.stringify(cleanClothing(p.clothing));
}

/** A loaded file's container and the outfit tints made from it. */
export function disposeFile(f: LoadedFile): void {
  for (const m of f.tinted?.values() ?? []) m.dispose(false, false);
  f.tinted?.clear();
  f.container.dispose();
}

/**
 * The outfit on a copy (play/outfit.js, the Wardrobe's rules): the parts it doesn't wear hidden, the trousers and
 * the top tinted (their own colour × the tint, in linear space as glTF colours are). A tinted material is a copy
 * made once per file and colour, shared by everyone wearing it (the file's own materials are never changed).
 * Not a Rocketbox outfit file (`outfit` not 'rocketbox'): nothing changes.
 */
export function wearOutfit(file: LoadedFile, character: CharacterFile, meshes: AbstractMesh[], clothing: Clothing | null): void {
  if (character.outfit !== 'rocketbox') return;
  const partOf = (m: AbstractMesh) => partName(m.name, m.parent?.name ?? null);
  const look = outfitLook(character.outfit, clothing, meshes.map(partOf));
  if (!look) return;
  const hidden = new Set(look.hidden);
  for (const m of meshes) {
    const part = partOf(m);
    if (hidden.has(part)) { m.setEnabled(false); continue; }
    const hex = look.tints[part];
    if (hex && m.material) m.material = tintedMaterial(file, m.material, hex);
  }
}

function tintedMaterial(file: LoadedFile, source: Material, hex: string): Material {
  file.tinted ??= new Map();
  const key = `${source.uniqueId}|${hex}`;
  let made = file.tinted.get(key);
  if (!made) {
    made = source.clone(`${source.name}_${hex}`) ?? source;
    const tint = Color3.FromHexString(hex).toLinearSpace();
    const m = made as Material & { albedoColor?: Color3; diffuseColor?: Color3 };
    if (m.albedoColor) m.albedoColor = m.albedoColor.multiply(tint);
    else if (m.diffuseColor) m.diffuseColor = m.diffuseColor.multiply(tint);
    file.tinted.set(key, made);
  }
  return made;
}

function samePlace(a: PlacedPerson, b: PlacedPerson): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.seated === b.seated && a.seatHeight === b.seatHeight;
}

/** World matrices from the top down (a child's uses its parent's). */
export function refreshTree(top: TransformNode): void {
  top.computeWorldMatrix(true);
  for (const n of top.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
}

/** Height and lowest point of the meshes in their rest pose (skinned on the CPU). */
function measure(meshes: AbstractMesh[]): { height: number; minY: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const m of meshes) {
    if (!m.getTotalVertices()) continue;
    m.refreshBoundingInfo({ applySkeleton: true });
    const bb = m.getBoundingInfo().boundingBox;
    min = Math.min(min, bb.minimumWorld.y);
    max = Math.max(max, bb.maximumWorld.y);
  }
  return Number.isFinite(min) && max - min > 0.01 ? { height: max - min, minY: min } : { height: FIGURE_HEIGHT, minY: 0 };
}

function rotationOf(node: TransformNode): Quaternion {
  node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
  return node.rotationQuaternion;
}

/**
 * Turn `bone` so that `toward` (further down its chain) lies in direction
 * `dir` of the character's frame (`root`: +Y up, +Z forward; dir[0] > 0 =
 * towards the bone's own side). Solved in the bone's parent's frame, so a
 * mirrored glTF hierarchy is no problem.
 */
function aimBone(root: TransformNode, bone: TransformNode | undefined, toward: TransformNode | undefined, dir: number[]): void {
  if (!bone || !toward || !(bone.parent instanceof TransformNode)) return;
  refreshTree(root);
  const rootInv = root.getWorldMatrix().clone().invert();
  const side = Math.sign(Vector3.TransformCoordinates(bone.getAbsolutePosition(), rootInv).x) || 1;
  const want = Vector3.TransformNormal(new Vector3(dir[0] * side, dir[1], dir[2]), root.getWorldMatrix());
  const now = toward.getAbsolutePosition().subtract(bone.getAbsolutePosition());
  if (now.lengthSquared() < 1e-10) return;
  const inv = bone.parent.getWorldMatrix().clone().invert();
  const from = Vector3.TransformNormal(now, inv).normalize();
  const to = Vector3.TransformNormal(want, inv).normalize();
  const turn = Quaternion.Identity();
  Quaternion.FromUnitVectorsToRef(from, to, turn);
  bone.rotationQuaternion = turn.multiply(rotationOf(bone));
}

/** The neutral simple figure (no face, no clothes), facing +Z, its feet / the seat's foot at the origin. */
function buildFigure(scene: Scene, seated: boolean, mat: StandardMaterial): Mesh {
  const parts: Mesh[] = [];
  const BODY = [0.48, 0.53, 0.6, 1];
  const HEAD = [0.79, 0.81, 0.85, 1];
  const add = (mesh: Mesh, at: [number, number, number], color: number[], tilt = 0) => {
    mesh.position.set(...at);
    mesh.rotation.x = tilt;
    const n = mesh.getTotalVertices();
    const colors = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) colors.set(color, i * 4);
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    parts.push(mesh);
  };
  const box = (w: number, h: number, d: number) => MeshBuilder.CreateBox('fig', { width: w, height: h, depth: d }, scene);
  if (seated) {
    add(MeshBuilder.CreateCapsule('fig', { height: 0.62, radius: 0.16 }, scene), [0, 0.86, -0.1], BODY, 0.08);
    add(MeshBuilder.CreateSphere('fig', { diameter: 0.23, segments: 10 }, scene), [0, 1.3, -0.06], HEAD);
    add(box(0.34, 0.15, 0.5), [0, 0.6, 0.13], BODY);
    add(box(0.3, 0.52, 0.13), [0, 0.3, 0.36], BODY);
    for (const s of [-1, 1]) {
      add(box(0.09, 0.3, 0.1), [s * 0.2, 0.98, -0.06], BODY, 0.35);
      add(box(0.08, 0.08, 0.34), [s * 0.17, 0.83, 0.13], BODY);
    }
  } else {
    add(MeshBuilder.CreateCapsule('fig', { height: 0.66, radius: 0.17 }, scene), [0, 1.2, 0], BODY);
    add(MeshBuilder.CreateSphere('fig', { diameter: 0.24, segments: 10 }, scene), [0, 1.63, 0], HEAD);
    for (const s of [-1, 1]) {
      add(box(0.13, 0.88, 0.14), [s * 0.09, 0.44, 0], BODY);
      add(box(0.08, 0.62, 0.09), [s * 0.25, 1.15, 0], BODY);
    }
  }
  const mesh = Mesh.MergeMeshes(parts, true, true)!;
  mesh.name = seated ? 'people_seated' : 'people_standing';
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.metadata = { people: seated ? 'seated' : 'standing' };
  mesh.setEnabled(false);
  return mesh;
}
