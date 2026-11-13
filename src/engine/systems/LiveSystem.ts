/**
 * LiveSystem.ts — live presence (v0.16.1): the people who have the 3D Company page open, drawn where they walk.
 *
 * The page (AHDUS: its WebSocket) gives each live person's samples: add(person), update(personId, sample),
 * remove(personId). Everyone else stays at their desk (CharacterSystem); a live person's seated figure is hidden
 * (CharacterSystem.setLivePeople) and they are drawn here instead:
 * - walking (a sample with x, z): LIVE_DELAY_MS behind, gliding (play/live.js createTrack), a jump over
 *   SNAP_DISTANCE m snapped; on the page but looking from above ('overview'): standing beside their desk
 *   (play/live standingSpot); a live person with no sample here yet (another floor) is not drawn.
 * - the nearest MAX_LIVE_DRAWN on the floor shown; of them the nearest `fullCap` with a character file are full
 *   characters (the walkthrough's animated character: Idle / Walk / Run / Wave, systems/PlayerCharacter), the
 *   others simple standing figures (one thin-instance mesh, `live_people`).
 * - a name tag over each one drawn (HTML in the viewer's tag layer: setTagLayer), hidden behind a wall
 *   (a ray every TAG_CHECK_MS), off screen, or further than TAG_RANGE.
 * - silent for SILENT_MS (no sample, no keepalive): they left, back to their desk.
 * Nothing here is saved, pickable or part of the layout.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Meshes/thinInstanceMesh';

import {
  cleanLive, cleanSample, createTrack, chooseLiveDrawn, standingSpot, hasPosition,
  SILENT_MS, MAX_LIVE_DRAWN, FULL_CAP_MIN,
} from '../../play/live';
import { chooseFullCharacters } from '../../play/people';
import { elevationOf } from '../../play/building';
import { cleanClothing } from '../../play/outfit';
import { buildFigure, validCharacter } from './CharacterSystem';
import type { CharacterSystem, CharacterFile, Clothing } from './CharacterSystem';
import { animatedCharacter, PLAYER_CLIPS } from './PlayerCharacter';
import type { PlayCharacter } from './PlayerCharacter';

/** A live person as the engine takes it (the embed resolves assetReference to `character`). */
export interface LivePersonInput {
  personId: string;
  name?: string;
  department?: string;
  character?: CharacterFile | null;
  clothing?: Clothing | null;
  floor?: number;
  x?: number;
  z?: number;
  /** Height above their floor (m): on stairs. */
  y?: number;
  yaw?: number;
  state?: 'idle' | 'walk' | 'run' | 'wave' | 'overview';
}

/** What tests and the page can see of a live person. */
export interface LiveInfo {
  personId: string;
  name: string;
  floor: number | null;
  state: string | null;
  /** Drawn now: 'full', 'figure', or null (another floor, not near enough, no position). */
  drawn: 'full' | 'figure' | null;
  /** Where they are drawn (world space), when drawn. */
  at: { x: number; y: number; z: number; yaw: number } | null;
  /** Standing beside their desk (on the page, looking from above). */
  atDesk: boolean;
}

export interface LiveSystemOptions {
  /** The layout (store state): floors, objects, currentFloor. */
  getLayout: () => { floors: Record<string | number, unknown>; currentFloor?: number };
  /** People at desks (null with quality 'low': only simple figures here then). */
  characters: CharacterSystem | null;
  /** Where someone sits (CharacterSystem's placement, or setPeople's desk): for standing up beside it. */
  seatOf: (personId: string) => { x: number; y: number; z: number; yaw: number; floor: number; seated: boolean } | null;
  /** Where the looking is from: the walker (walking), else null (the camera's target). */
  getWalker: () => { x: number; z: number; floor: number } | null;
  /** The signed-in person: never drawn here (they are walking themselves). */
  getMe: () => string | null;
  /** The clock (ms; tests). */
  now?: () => number;
  silentMs?: number;
  maxDrawn?: number;
}

interface Entry {
  info: { personId: string; name: string; department: string; character: CharacterFile | null; clothing: Clothing | null };
  track: ReturnType<typeof createTrack>;
  floor: number | null;
  state: string | null;
  overview: boolean;
  /** Drawn this frame. */
  at: { x: number; y: number; z: number; yaw: number; floor: number; speed: number; state: string | null } | null;
  walker: PlayCharacter | null;
  /** The character key the walker was made for (another = made again). */
  walkerKey: string;
  /** Being made (async: the file, its clips). */
  making: number;
  waved: boolean;
}

/** Name tags further than this (m) are hidden. */
export const TAG_RANGE = 25;
/** A tag near the side of the view is kept this far (CSS px) inside it. */
export const TAG_EDGE = 4;
/** Behind-a-wall check of each tag, this often (ms). */
const TAG_CHECK_MS = 250;
/** Who is drawn and who is a full character is decided again this often (ms). */
const CHOOSE_EVERY_MS = 300;
/** The simple figures' colour while live (a little green: AHDUS). */
const LIVE_FIGURE = new Color3(0.56, 0.7, 0.63);
const FIGURE_HEIGHT = 1.75;

export class LiveSystem {
  private scene: Scene;
  private options: LiveSystemOptions;
  private entries = new Map<string, Entry>();
  private observer: Observer<Scene> | null;
  private afterObserver: Observer<Scene> | null;
  private disposed = false;
  private fullCap = FULL_CAP_MIN;
  private drawn: string[] = [];
  private fullIds: string[] = [];
  private wanted = 0;
  private lastChoice = -Infinity;
  private lastFrame = -1;
  private figure: Mesh | null = null;
  private figureMat: StandardMaterial | null = null;
  private tagLayer: HTMLElement | null = null;
  private tags = new Map<string, HTMLElement>();
  private hiddenTags = new Map<string, boolean>();
  /** Each tag's width in CSS px, measured once per name (so a tag near the edge is kept inside the view). */
  private tagWidths = new Map<string, number>();
  private lastTagCheck = -Infinity;
  private token = 0;
  private silentMs: number;
  private maxDrawn: number;

  constructor(scene: Scene, options: LiveSystemOptions) {
    this.scene = scene;
    this.options = options;
    this.silentMs = options.silentMs ?? SILENT_MS;
    this.maxDrawn = options.maxDrawn ?? MAX_LIVE_DRAWN;
    this.observer = scene.onBeforeRenderObservable.add(() => this.frame());
    this.afterObserver = scene.onAfterRenderObservable.add(() => this.placeTags());
  }

  // ── Public ─────────────────────────────────────────────────────────────

  /** Add a live person (or replace them: their samples start again). false: no personId. */
  add(raw: LivePersonInput): boolean {
    const clean = cleanLive(raw);
    if (!clean || this.disposed) return false;
    this.drop(clean.personId);
    const entry: Entry = {
      info: { personId: clean.personId, name: clean.name, department: clean.department, character: null, clothing: null },
      track: createTrack(), floor: null, state: null, overview: false, at: null, walker: null, walkerKey: '', making: 0, waved: false,
    };
    this.entries.set(clean.personId, entry);
    this.apply(entry, raw, clean);
    this.syncHidden();
    this.lastChoice = -Infinity;
    return true;
  }

  /**
   * A new sample for a live person ({ floor, x, z, y, yaw, state }) and / or new details (name, department,
   * character, clothing). No x / z: their position isn't known here (another floor), or 'overview'.
   * false: not a live person (add them first).
   */
  update(personId: string, patch: Partial<LivePersonInput>): boolean {
    const entry = this.entries.get(String(personId));
    if (!entry || this.disposed) return false;
    const clean = cleanLive({ ...patch, personId: entry.info.personId, name: patch?.name ?? entry.info.name,
      department: patch?.department ?? entry.info.department })!;
    this.apply(entry, patch ?? {}, clean);
    return true;
  }

  /** They left the page: back to their desk. */
  remove(personId: string): boolean {
    const had = this.drop(String(personId));
    if (had) this.syncHidden();
    return had;
  }

  /** Everyone back to their desk (the connection dropped). */
  clear(): void {
    for (const id of [...this.entries.keys()]) this.drop(id);
    this.syncHidden();
  }

  /** Everyone live now. */
  list(): LiveInfo[] {
    return [...this.entries.values()].map((e) => ({
      personId: e.info.personId,
      name: e.info.name,
      floor: e.floor,
      state: e.state,
      drawn: !e.at || !this.drawn.includes(e.info.personId) ? null : e.walker && this.fullIds.includes(e.info.personId) ? 'full' : 'figure',
      at: e.at ? { x: e.at.x, y: e.at.y, z: e.at.z, yaw: e.at.yaw } : null,
      atDesk: e.overview,
    }));
  }

  get count(): number {
    return this.entries.size;
  }

  /** At most this many live full characters (LayoutEngine: the device's cap). */
  setFullCap(n: number): void {
    const next = Math.max(0, Math.floor(Number(n) || 0));
    if (next === this.fullCap) return;
    this.fullCap = next;
    this.lastChoice = -Infinity;
  }

  /** How many live people are full characters (or being made): the seated ones get the rest of the cap. */
  get fullCount(): number {
    return this.fullIds.length;
  }

  /** How many live people near would be full characters with no cap. */
  get wantedFull(): number {
    return this.wanted;
  }

  /** The viewer's element for the name tags (over the canvas, pointer-events none); null: no tags. */
  setTagLayer(el: HTMLElement | null): void {
    if (this.tagLayer === el) return;
    for (const tag of this.tags.values()) tag.remove();
    this.tags.clear();
    this.tagLayer = el;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.scene.onAfterRenderObservable.remove(this.afterObserver);
    for (const id of [...this.entries.keys()]) this.drop(id);
    this.options.characters?.setLivePeople([]);
    this.figure?.dispose();
    this.figureMat?.dispose();
    this.setTagLayer(null);
  }

  // ── Frames ─────────────────────────────────────────────────────────────

  /** Before every frame: the silent ones leave, the others are stepped, drawn and animated. */
  frame(): void {
    if (this.disposed || this.scene.isDisposed) return;
    const now = this.now();
    const dt = this.lastFrame < 0 ? 0 : Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    let left = false;
    for (const [id, e] of [...this.entries]) {
      if (now - e.track.lastHeard > this.silentMs) { this.drop(id); left = true; }
    }
    if (left) this.syncHidden();
    const floors = this.options.getLayout().floors;
    for (const e of this.entries.values()) e.at = this.spotOf(e, now, floors);
    if (now - this.lastChoice >= CHOOSE_EVERY_MS) {
      this.lastChoice = now;
      this.choose();
    }
    this.animate(dt);
    this.syncFigures();
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  /** Where a live person is drawn now (world space), or null. */
  private spotOf(e: Entry, now: number, floors: Record<string | number, unknown>): Entry['at'] {
    if (e.overview) {
      const spot = standingSpot(this.options.seatOf(e.info.personId));
      return spot ? { ...spot, speed: 0, state: 'idle' } : null;
    }
    const s = e.track.step(now);
    if (!s) return null;
    const base = elevationOf(floors as never, s.floor);
    return { x: s.x, y: base + (s.y ?? 0), z: s.z, yaw: s.yaw, floor: s.floor, speed: s.speed, state: s.state };
  }

  /** Who is drawn (the nearest on the floor shown) and who of them is a full character. */
  private choose(): void {
    this.syncHidden(); // (the signed-in person may have changed)
    const floor = this.shownFloor();
    const me = this.options.getMe();
    const here = [...this.entries.values()].filter((e) => e.at && e.info.personId !== me)
      .map((e) => ({ personId: e.info.personId, floor: e.at!.floor, x: e.at!.x, y: e.at!.y, z: e.at!.z, character: e.info.character }));
    const walker = this.options.getWalker();
    const camera = this.scene.activeCamera;
    const target = (camera as { getTarget?: () => Vector3 } | null)?.getTarget?.() ?? null;
    const from = walker ?? (target ? { x: target.x, z: target.z } : null);
    this.drawn = chooseLiveDrawn(here, from, floor, this.maxDrawn);
    const drawnSet = new Set(this.drawn);
    const candidates = here.filter((p) => drawnSet.has(p.personId));
    // full characters: the nearest to the camera's view (people.chooseFullCharacters: within 15 m, kept to 18 m)
    const eye = camera?.globalPosition ?? new Vector3(from?.x ?? 0, 1.6, from?.z ?? 0);
    const characters = this.options.characters;
    const ok = characters ? candidates.filter((p) => !!p.character?.url && characters.fileState(p.character.url) !== 'failed') : [];
    const current = this.fullIds;
    const focus = walker ? { x: walker.x, y: eye.y, z: walker.z } : target;
    this.fullIds = chooseFullCharacters(ok, eye, floor, { max: this.fullCap, current, focus });
    this.wanted = this.fullIds.length < this.fullCap ? this.fullIds.length
      : chooseFullCharacters(ok, eye, floor, { max: Infinity, current, focus }).length;
    const full = new Set(this.fullIds);
    for (const e of this.entries.values()) {
      const id = e.info.personId;
      if (!full.has(id)) { this.dropWalker(e); continue; }
      const key = keyOf(e.info);
      if (e.walker && e.walkerKey !== key) this.dropWalker(e);
      // the file in use stays loaded (CharacterSystem unloads files nobody near has used for a while)
      if (e.walker && e.info.character) characters?.useFile(e.info.character.url);
      if (!e.walker && !e.making) this.makeWalker(e, key);
    }
  }

  private shownFloor(): number {
    return this.options.getWalker()?.floor ?? this.options.getLayout().currentFloor ?? 0;
  }

  /** A full character for a live person: its file through CharacterSystem's queue, its clips through the library. */
  private makeWalker(e: Entry, key: string): void {
    const characters = this.options.characters;
    const character = e.info.character;
    if (!characters || !character) return;
    const file = characters.useFile(character.url);
    if (!file || file === 'failed') return; // queued: tried again next time
    const token = ++this.token;
    e.making = token;
    characters.clipLibrary.clips(character, file, PLAYER_CLIPS).then((clips) => {
      if (this.disposed || e.making !== token) return;
      e.making = 0;
      if (this.entries.get(e.info.personId) !== e || !this.fullIds.includes(e.info.personId) || keyOf(e.info) !== key) return;
      e.walker = animatedCharacter(this.scene, file, { character, clothing: e.info.clothing }, clips,
        { name: `live_${e.info.personId}`, metadata: { livePersonId: e.info.personId } });
      e.walkerKey = key;
      e.waved = false;
    }, (err) => {
      if (e.making === token) e.making = 0;
      console.warn(`[live] could not draw ${e.info.personId} as their character: a simple figure`, err?.message ?? err);
    });
  }

  /** Move and animate the full characters. */
  private animate(dt: number): void {
    const drawn = new Set(this.drawn);
    for (const e of this.entries.values()) {
      const w = e.walker;
      if (!w) continue;
      const show = !!e.at && drawn.has(e.info.personId);
      w.setVisible(show);
      if (!show) continue;
      const at = e.at!;
      w.root.position.set(at.x, at.y, at.z);
      w.root.rotation.y = at.yaw;
      const state = at.state;
      const gait = state === 'walk' ? 'Walk' : state === 'run' ? 'Run' : state === 'idle' || state === 'wave' ? 'Idle' : null;
      w.update(dt, at.speed, false, { gait });
      if (state === 'wave' && !e.waved) {
        w.wave?.(); // once per wave: their browser says 'wave' while it plays
        e.waved = true;
      } else if (state !== 'wave') e.waved = false;
    }
  }

  /** One thin instance per live person drawn who isn't a full character (yet). */
  private syncFigures(): void {
    const drawn = this.drawn.map((id) => this.entries.get(id)).filter((e): e is Entry => !!e?.at && !e.walker);
    if (!drawn.length && !this.figure) return;
    const mesh = this.ensureFigure();
    if (!drawn.length) {
      mesh.thinInstanceCount = 0;
      mesh.setEnabled(false);
      return;
    }
    const data = new Float32Array(drawn.length * 16);
    drawn.forEach((e, i) => {
      const s = (e.info.character?.height ?? FIGURE_HEIGHT) / FIGURE_HEIGHT;
      Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationAxis(Vector3.Up(), e.at!.yaw), new Vector3(e.at!.x, e.at!.y, e.at!.z))
        .copyToArray(data, i * 16);
    });
    mesh.thinInstanceSetBuffer('matrix', data, 16, false);
    mesh.thinInstanceRefreshBoundingInfo(false);
    mesh.setEnabled(true);
  }

  private ensureFigure(): Mesh {
    if (this.figure) return this.figure;
    const mat = new StandardMaterial('live_figure', this.scene);
    mat.diffuseColor = LIVE_FIGURE.clone();
    mat.specularColor = new Color3(0.08, 0.08, 0.08);
    this.figureMat = mat;
    this.figure = buildFigure(this.scene, false, mat);
    this.figure.name = 'live_people';
    this.figure.metadata = { people: 'live' };
    return this.figure;
  }

  // ── Name tags ──────────────────────────────────────────────────────────

  /** After every frame: each drawn person's tag over their head (HTML), hidden behind walls and far away. */
  private placeTags(): void {
    const layer = this.tagLayer;
    if (!layer || this.disposed) return;
    const camera = this.scene.activeCamera;
    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    const shown = new Set<string>();
    if (camera) {
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const css = canvas && canvas.clientWidth > 0 && w > 0 ? canvas.clientWidth / w : 1;
      const viewport = camera.viewport.toGlobal(w, h);
      const layerWidth = layer.clientWidth || w * css;
      const transform = this.scene.getTransformMatrix();
      const eye = camera.globalPosition;
      const now = this.now();
      const check = now - this.lastTagCheck >= TAG_CHECK_MS;
      if (check) this.lastTagCheck = now;
      for (const id of this.drawn) {
        const e = this.entries.get(id);
        if (!e?.at || !e.info.name) continue;
        const height = e.info.character?.height ?? FIGURE_HEIGHT;
        const head = new Vector3(e.at.x, e.at.y + height + 0.28, e.at.z);
        const d = Vector3.Distance(eye, head);
        if (d > TAG_RANGE) continue;
        const p = Vector3.Project(head, Matrix.IdentityReadOnly, transform, viewport);
        if (p.z < 0 || p.z > 1 || p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
        if (check) this.hiddenTags.set(id, this.behindWall(eye, head));
        if (this.hiddenTags.get(id)) continue;
        const tag = this.tagFor(e);
        if (tag.style.display === 'none') tag.style.display = '';
        let width = this.tagWidths.get(id);
        if (!width) { width = tag.offsetWidth; if (width) this.tagWidths.set(id, width); }
        const half = (width || 0) / 2;
        const x = clampTagX(p.x * css, half, layerWidth);
        tag.style.transform = `translate(${x.toFixed(1)}px, ${(p.y * css).toFixed(1)}px) translate(-50%, -100%)`;
        tag.style.opacity = String(Math.min(1, Math.max(0.35, 1.25 - d / TAG_RANGE)));
        tag.style.display = '';
        shown.add(id);
      }
    }
    for (const [id, tag] of this.tags) {
      if (!this.entries.has(id)) { tag.remove(); this.tags.delete(id); this.hiddenTags.delete(id); this.tagWidths.delete(id); } else if (!shown.has(id)) tag.style.display = 'none';
    }
  }

  /** Is a wall (or a floor, a roof) between the camera and this point? */
  private behindWall(eye: Vector3, point: Vector3): boolean {
    const dir = point.subtract(eye);
    const length = dir.length();
    if (length < 0.5) return false;
    const ray = new Ray(eye, dir.scale(1 / length), length - 0.3);
    const hit = this.scene.pickWithRay(ray, (m: AbstractMesh) => m.isEnabled() && m.isVisible && !!m.metadata?.roomId
      && !m.metadata?.pickPane && m.metadata?.part !== 'door', true);
    return !!hit?.hit;
  }

  private tagFor(e: Entry): HTMLElement {
    const id = e.info.personId;
    let tag = this.tags.get(id);
    if (tag) {
      const label = tag.lastChild as HTMLElement;
      if (label.textContent !== e.info.name) { label.textContent = e.info.name; this.tagWidths.delete(id); }
      return tag;
    }
    tag = document.createElement('div');
    tag.setAttribute('data-live-tag', id);
    Object.assign(tag.style, {
      position: 'absolute', left: '0', top: '0', display: 'flex', alignItems: 'center', gap: '5px',
      padding: '2px 8px 2px 6px', borderRadius: '999px', background: 'rgba(255,255,255,0.94)', color: '#1d2a24',
      font: '600 12px/16px Inter, system-ui, sans-serif', whiteSpace: 'nowrap', maxWidth: '170px', overflow: 'hidden',
      textOverflow: 'ellipsis', boxShadow: '0 1px 4px rgba(16,40,30,0.25)', pointerEvents: 'none', willChange: 'transform',
    } as Partial<CSSStyleDeclaration>);
    const dot = document.createElement('span');
    Object.assign(dot.style, { width: '7px', height: '7px', borderRadius: '50%', background: '#28664f', flex: '0 0 auto' });
    const label = document.createElement('span');
    label.textContent = e.info.name;
    Object.assign(label.style, { overflow: 'hidden', textOverflow: 'ellipsis' });
    tag.append(dot, label);
    this.tagLayer!.append(tag);
    this.tags.set(id, tag);
    return tag;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /** New details and a sample onto an entry. */
  private apply(e: Entry, raw: Partial<LivePersonInput>, clean: NonNullable<ReturnType<typeof cleanLive>>): void {
    if (raw.name !== undefined) e.info.name = clean.name;
    if (raw.department !== undefined) e.info.department = clean.department;
    if (raw.character !== undefined) e.info.character = validCharacter(raw.character ?? null);
    if (raw.clothing !== undefined) e.info.clothing = cleanClothing(raw.clothing);
    const sample = cleanSample(raw);
    const now = this.now();
    if (sample.floor !== null) e.floor = sample.floor;
    if (sample.state) e.state = sample.state;
    const hasAny = sample.floor !== null || sample.state !== null || hasPosition(sample) || raw.x !== undefined;
    if (!hasAny) { e.track.touch(now); return; }
    if (sample.state === 'overview') {
      e.overview = true;
      e.track.clear();
      e.track.touch(now);
      return;
    }
    if (hasPosition(sample)) {
      e.overview = false;
      e.track.push({ ...sample, floor: sample.floor ?? e.floor ?? 0 }, now);
    } else if (sample.floor !== null) {
      // on another floor (or not known yet): not drawn until a sample comes
      e.overview = false;
      e.track.clear();
      e.track.touch(now);
    } else {
      e.track.touch(now);
    }
  }

  private drop(personId: string): boolean {
    const e = this.entries.get(personId);
    if (!e) return false;
    this.dropWalker(e);
    e.making = 0;
    this.entries.delete(personId);
    this.drawn = this.drawn.filter((id) => id !== personId);
    this.fullIds = this.fullIds.filter((id) => id !== personId);
    return true;
  }

  private dropWalker(e: Entry): void {
    e.making = 0;
    if (!e.walker) return;
    e.walker.dispose();
    e.walker = null;
    e.walkerKey = '';
  }

  /** Their seated figures hidden: everyone live (the signed-in person is CharacterSystem's hiddenPerson). */
  private syncHidden(): void {
    const me = this.options.getMe();
    this.options.characters?.setLivePeople([...this.entries.keys()].filter((id) => id !== me));
  }
}

/** A live person's look, as a key (another = their character made again). */
function keyOf(info: Entry['info']): string {
  const c = info.character;
  return c ? JSON.stringify([c.url, c.rig, c.height, c.outfit ?? null, c.clips ?? null, cleanClothing(info.clothing)]) : '';
}

/** A tag's middle, kept so the whole tag (half its width each side) stays `TAG_EDGE` px inside the view. */
export function clampTagX(x: number, half: number, width: number): number {
  if (!(width > 0) || width < 2 * (half + TAG_EDGE)) return x;
  return Math.min(width - half - TAG_EDGE, Math.max(half + TAG_EDGE, x));
}
