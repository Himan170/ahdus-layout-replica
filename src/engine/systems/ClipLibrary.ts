/**
 * ClipLibrary.ts — the shared animation library (v0.16.0).
 *
 * A character's clips (Idle, Walk, Run, Wave, Sit, Type) come from its clip set (manifest v2 `clips`: an
 * animation-only .glb shared by every character of that set) or, without one, from its own file (the Rocketbox
 * files carry 13 clips). Each clip is RETARGETED onto a character file once (bakeClip: every bone the two files name
 * alike, by play/people boneKey, turned as much in the character's frame as in the clip's from their rest poses; the
 * clip's forward motion taken out) and kept as data (tracks: bone key → Animation). A person gets clones of those
 * tracks on their own bones (an AnimationGroup each, the Animation objects shared), played by an Animator with
 * cross-fades (animation weights).
 *
 * Tests: engine/__tests__/ClipLibrary.test.ts (our own placeholder clip set, scripts/make-placeholder-character.mjs).
 */

import type { Scene } from '@babylonjs/core/scene';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Animation } from '@babylonjs/core/Animations/animation';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Animations/animatable';

import { boneKey, clipSpeed } from '../../play/people';
import { copyCharacter, refreshTree, restContainer } from './CharacterSystem';
import type { CharacterFile, CharacterCopy, LoadedFile } from './CharacterSystem';

/** The clips the 3D Workplace plays (names as in the clip sets and the Rocketbox files; case doesn't matter). */
export const CLIP_NAMES = Object.freeze(['Idle', 'Walk', 'Run', 'Wave', 'Sit', 'Type'] as const);
export type ClipName = (typeof CLIP_NAMES)[number];

/** Samples per second of a baked clip (a clip longer than LONG_CLIP_S, an idle, slow: SLOW_SAMPLES), at most MAX_SAMPLES. */
const SAMPLES_PER_SECOND = 30;
const SLOW_SAMPLES = 15;
const LONG_CLIP_S = 4;
const MAX_SAMPLES = 400;
/** A clip and a character must share at least this many bones (and Hips). */
const MIN_SHARED_BONES = 6;
/** Cross-fade between clips (s). */
export const FADE_S = 0.25;

/** A clip retargeted onto one character file: data only, cloned onto each person's bones. */
export interface BakedClip {
  name: string;
  tracks: { key: string; animation: Animation }[];
  /** Keys 0 … frames. */
  frames: number;
  /** One cycle (s). */
  duration: number;
  /** How fast it moves at its own speed (m/s, the character's size): Walk / Run; null for the others. */
  speed: number | null;
}

type BoneTarget = Pick<CharacterCopy, 'root' | 'bones'> & { allBones?: Map<string, TransformNode> };

// ── Baking ───────────────────────────────────────────────────────────────

/**
 * Bake `group` (it animates the nodes under `top`; `srcBones` = them by boneKey) onto the character's bones; null
 * if they share too few bones. The character is left in the last sample's pose (bake onto a copy you throw away,
 * or restore it).
 */
export function bakeClip(
  _scene: Scene, group: AnimationGroup, top: TransformNode, srcBones: Map<string, TransformNode>,
  target: BoneTarget, name: string,
): BakedClip | null {
  const bones = target.allBones ?? target.bones;
  const pairs = [...bones]
    .filter(([key, node]) => srcBones.has(key) && node.parent instanceof TransformNode)
    .sort((a, b) => depth(a[1]) - depth(b[1]));
  if (pairs.length < MIN_SHARED_BONES || !pairs.some(([key]) => key === 'Hips')) return null;
  const animations = group.targetedAnimations;
  if (!animations.length) return null;
  const fps = animations[0].animation.framePerSecond || 60;
  const duration = (group.to - group.from) / fps;
  if (!(duration > 0)) return null;
  const perSecond = duration > LONG_CLIP_S ? SLOW_SAMPLES : SAMPLES_PER_SECOND;
  const n = Math.min(MAX_SAMPLES, Math.max(8, Math.round(duration * perSecond)));

  // Rest poses: the clip's (as its file has it) and the character's
  refreshTree(top);
  refreshTree(target.root);
  const srcRest = new Map(pairs.map(([key]) => [key, rotationPart(srcBones.get(key)!.getWorldMatrix())]));
  const tgtRest = new Map(pairs.map(([key, node]) => [key, rotationPart(node.getWorldMatrix())]));
  const srcHips = srcBones.get('Hips')!;
  const tgtHips = bones.get('Hips')!;
  const srcHipsRest = srcHips.getAbsolutePosition().clone();
  const tgtHipsRest = tgtHips.getAbsolutePosition().clone();
  const ground = Math.min(...[...srcBones.values()].map((b) => b.getAbsolutePosition().y));
  const feetY = target.root.getAbsolutePosition().y;
  const size = (tgtHipsRest.y - feetY) / Math.max(1e-3, srcHipsRest.y - ground); // character / clip

  // Sample the clip: each bone's rotation in the clip's frame, the hips and a foot. The clip's world matrices are
  // composed here (scale, rotation, position × the parent's), not by Babylon's computeWorldMatrix per node and
  // sample (that was most of a bake): only nodes, parents first (getDescendants is depth-first), no meshes.
  const srcNodes = top.getDescendants(false).filter((d): d is TransformNode =>
    d instanceof TransformNode && !('getTotalVertices' in d));
  const slot = new Map(srcNodes.map((node, k) => [node, k]));
  const parentSlot = srcNodes.map((node) => slot.get(node.parent as TransformNode) ?? -1);
  const topWorld = top.getWorldMatrix().clone();
  const local = srcNodes.map(() => new Matrix());
  const world = srcNodes.map(() => new Matrix());
  const turnQ = new Quaternion();
  const pairSlots = pairs.map(([key]) => slot.get(srcBones.get(key)!) ?? -1);
  const hipsSlot = slot.get(srcHips) ?? -1;
  const srcFoot = srcBones.get('LeftFoot');
  const footSlot = srcFoot ? slot.get(srcFoot) ?? -1 : -1;
  const worlds: Matrix[][] = [];
  const hips: Vector3[] = [];
  const foot: number[] = [];
  for (let i = 0; i <= n; i++) {
    const frame = group.from + ((group.to - group.from) * i) / n;
    for (const { animation, target: node } of animations) {
      const value = animation.evaluate(frame);
      (node as Record<string, unknown>)[animation.targetProperty] = value?.clone ? value.clone() : value;
    }
    srcNodes.forEach((node, k) => {
      const q = node.rotationQuaternion ?? Quaternion.FromEulerVectorToRef(node.rotation, turnQ);
      Matrix.ComposeToRef(node.scaling, q, node.position, local[k]);
      local[k].multiplyToRef(parentSlot[k] < 0 ? topWorld : world[parentSlot[k]], world[k]);
    });
    worlds.push(pairSlots.map((k) => rotationPart(world[k])));
    const h = Vector3.FromArray(world[hipsSlot].m, 12);
    hips.push(h);
    if (footSlot >= 0) foot.push(world[footSlot].m[14] - h.z);
  }
  const travel = hips[n].z - hips[0].z;
  const drift = hips[n].x - hips[0].x;
  const footRange = foot.length ? Math.max(...foot) - Math.min(...foot) : 0;
  const moves = Math.hypot(travel, drift) >= 0.2;
  const speed = moves || /^(walk|run)$/i.test(name) ? clipSpeed({ duration, hipsTravel: travel, footRange }) * size : 0;

  // Bake: the character's bones turned as much (in its frame) as the clip's turn from their rest pose. Done on
  // matrices, not on the scene graph (that was ~1 s for a Rocketbox idle): a bone's parent's world rotation is its
  // nearest baked ancestor's (this sample) times the fixed nodes between them (their rest pose), else its rest.
  const index = new Map(pairs.map(([key, node], k) => [node, k]));
  const above = pairs.map(([, node]) => {
    const parent = node.parent as TransformNode;
    let a: TransformNode | null = parent;
    while (a && !index.has(a)) a = a.parent as TransformNode | null;
    const parentRest = rotationPart(parent.getWorldMatrix());
    if (!a) return { from: -1, fixed: parentRest };
    // parentWorld = fixed × ancestorWorld (row vectors: world = local × parentWorld)
    return { from: index.get(a)!, fixed: parentRest.multiply(Matrix.Transpose(rotationPart(a.getWorldMatrix()))) };
  });
  const tgtHipsParentInv = Matrix.Invert((tgtHips.parent as TransformNode).getWorldMatrix());
  const srcRestInv = pairs.map(([key]) => Matrix.Transpose(srcRest.get(key)!));
  const keys = pairs.map(() => [] as { frame: number; value: Quaternion }[]);
  const hipsKeys: { frame: number; value: Vector3 }[] = [];
  const want: Matrix[] = new Array(pairs.length);
  for (let i = 0; i <= n; i++) {
    pairs.forEach(([key], k) => {
      want[k] = tgtRest.get(key)!.multiply(srcRestInv[k].multiply(worlds[i][k]));
      const { from, fixed } = above[k];
      const parentWorld = from < 0 ? fixed : fixed.multiply(want[from]);
      const local = want[k].multiply(Matrix.Transpose(parentWorld));
      keys[k].push({ frame: i, value: Quaternion.FromRotationMatrix(local).normalize() });
    });
    // the hips: the bob, sway and (sitting) the drop; the clip's forward motion taken out (the controls move you)
    const d = hips[i].subtract(hips[0]);
    d.x -= (drift * i) / n;
    d.z -= (travel * i) / n;
    d.y = hips[i].y - srcHipsRest.y;
    hipsKeys.push({ frame: i, value: Vector3.TransformCoordinates(tgtHipsRest.add(d.scale(size)), tgtHipsParentInv) });
  }

  const rate = n / duration;
  const tracks: BakedClip['tracks'] = pairs.map(([key], k) => {
    const anim = new Animation(`${name}_${key}`, 'rotationQuaternion', rate, Animation.ANIMATIONTYPE_QUATERNION,
      Animation.ANIMATIONLOOPMODE_CYCLE);
    anim.setKeys(keys[k]);
    return { key, animation: anim };
  });
  const hipsAnim = new Animation(`${name}_Hips_position`, 'position', rate, Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CYCLE);
  hipsAnim.setKeys(hipsKeys);
  tracks.push({ key: 'Hips', animation: hipsAnim });
  return { name, tracks, frames: n, duration, speed: speed > 0 ? speed : null };
}

/** A baked clip on a person's bones (by key): its own AnimationGroup, the Animation objects shared. */
export function instantiateClip(scene: Scene, clip: BakedClip, bones: Map<string, TransformNode>, name: string): AnimationGroup {
  const group = new AnimationGroup(name, scene);
  for (const { key, animation } of clip.tracks) {
    const node = bones.get(key);
    if (node) group.addTargetedAnimation(animation, node);
  }
  group.normalize(0, clip.frames);
  return group;
}

/** A baked clip's pose at `frame` set on a person's bones: a held pose, no animation running (v0.16.0). */
export function holdClip(clip: BakedClip, bones: Map<string, TransformNode>, frame = 0): void {
  for (const { key, animation } of clip.tracks) {
    const node = bones.get(key);
    if (!node) continue;
    const v = animation.evaluate(Math.min(Math.max(0, frame), clip.frames));
    if (animation.targetProperty === 'rotationQuaternion') node.rotationQuaternion = (v as Quaternion).clone();
    else if (animation.targetProperty === 'position') node.position.copyFrom(v as Vector3);
    else if (animation.targetProperty === 'scaling') node.scaling.copyFrom(v as Vector3);
  }
}

/** The nodes under `top` by boneKey (Mixamo with or without its prefix, Unreal-style, the biped rig). */
export function clipBones(top: TransformNode): Map<string, TransformNode> {
  const bones = new Map<string, TransformNode>();
  for (const node of top.getDescendants(false)) {
    if (!(node instanceof TransformNode)) continue;
    const key = boneKey(node.name);
    if (key && !bones.has(key)) bones.set(key, node);
  }
  return bones;
}

/** The animation group of a file called `name` (case doesn't matter). */
function groupNamed(groups: AnimationGroup[], name: string): AnimationGroup | null {
  const want = name.toLowerCase();
  return groups.find((g) => g.name.toLowerCase() === want) ?? null;
}

/**
 * What baking needs: a copy of the clip source (its nodes moved by its clips) and of the character (its rest pose),
 * both hidden. Made once for all the clips of one character and source, removed again after.
 */
export interface Bench {
  /** Bake one clip of the source (null: none of that name, or the bones don't fit). */
  bake(name: string): BakedClip | null;
  dispose(): void;
}

export function makeBench(scene: Scene, source: AssetContainer, file: LoadedFile, character: CharacterFile): Bench {
  restContainer(source);
  const src = source.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  for (const g of src.animationGroups) g.stop();
  const top = new TransformNode('clip_source', scene);
  for (const n of src.rootNodes) n.parent = top;
  for (const m of top.getChildMeshes(false)) m.setEnabled(false);
  const srcBones = clipBones(top);
  // the source's rest pose, put back before each clip (a clip leaves its last sample's pose)
  const nodes = top.getDescendants(false).filter((d): d is TransformNode => d instanceof TransformNode);
  const rest = nodes.map((n) => [n.position.clone(), n.rotationQuaternion?.clone() ?? null, n.rotation.clone(), n.scaling.clone()] as const);
  const target = copyCharacter(scene, file, character, 'clip_target');
  target.root.setEnabled(false);
  return {
    bake(name) {
      const group = groupNamed(src.animationGroups, name);
      if (!group) return null;
      nodes.forEach((n, k) => {
        const [p, q, r, sc] = rest[k];
        n.position.copyFrom(p);
        if (q) n.rotationQuaternion = q.clone();
        else n.rotation.copyFrom(r);
        n.scaling.copyFrom(sc);
      });
      refreshTree(top);
      return bakeClip(scene, group, top, srcBones, target, name);
    },
    dispose() {
      for (const g of src.animationGroups) g.dispose();
      for (const sk of src.skeletons) sk.dispose();
      top.dispose(false, false);
      target.root.dispose(false, false);
      for (const sk of target.skeletons) sk.dispose();
    },
  };
}

/** One clip of `source` (a clip set, or the character's own file) baked onto `file`'s character. */
export function bakeFromFiles(scene: Scene, source: AssetContainer, file: LoadedFile, character: CharacterFile,
  name: string): BakedClip | null {
  if (!groupNamed(source.animationGroups, name)) return null;
  const bench = makeBench(scene, source, file, character);
  try {
    return bench.bake(name);
  } finally {
    bench.dispose();
  }
}

// ── The library ──────────────────────────────────────────────────────────

/**
 * Clips baked once per character file (and height) and clip: `clip(character, file, 'Walk')`. The clip set is
 * loaded through `loadFile` (CharacterSystem's load-once queue). A clip that isn't there or doesn't fit = null
 * (the person keeps the held pose).
 */
export class ClipLibrary {
  private scene: Scene;
  private loadFile: (url: string) => Promise<LoadedFile>;
  private baked = new Map<string, Promise<BakedClip | null>>();
  /** Bakes run one at a time with a pause between them, so a frame can be drawn (~10–50 ms each). */
  private turn: Promise<unknown> = Promise.resolve();
  /** The copies of a character + source being baked from, and how many bakes still want them. */
  private benches = new Map<string, { bench: Bench | null; users: number }>();
  /** How many clips were baked (tests: each once). */
  bakes = 0;

  constructor(scene: Scene, loadFile: (url: string) => Promise<LoadedFile>) {
    this.scene = scene;
    this.loadFile = loadFile;
  }

  /** Where `character`'s clips come from: its clip set's url, else its own file's. */
  static sourceOf(character: CharacterFile): string {
    return character.clips ?? character.url;
  }

  clip(character: CharacterFile, file: LoadedFile, name: string): Promise<BakedClip | null> {
    const benchKey = [ClipLibrary.sourceOf(character), character.url, character.height ?? '', character.rig ?? 'mixamo'].join('|');
    const key = `${benchKey}|${name.toLowerCase()}`;
    let made = this.baked.get(key);
    if (!made) {
      const source = character.clips ? this.loadFile(character.clips) : Promise.resolve(file);
      made = source.then((src) => {
        if (!groupNamed(src.container.animationGroups, name)) return null;
        let b = this.benches.get(benchKey);
        if (!b) this.benches.set(benchKey, (b = { bench: null, users: 0 }));
        b.users++;
        const entry = b;
        const go = this.turn.then(pause).then(() => {
          if (this.scene.isDisposed) return null;
          entry.bench ??= makeBench(this.scene, src.container, file, character);
          this.bakes++;
          return entry.bench.bake(name);
        }).finally(() => {
          if (--entry.users > 0) return;
          entry.bench?.dispose();
          if (this.benches.get(benchKey) === entry) this.benches.delete(benchKey);
        });
        this.turn = go.catch(() => {});
        return go;
      }).catch((err) => {
        console.warn(`[characters] could not use the clip ${name} for ${character.url}: held pose`, err?.message ?? err);
        return null;
      });
      this.baked.set(key, made);
    }
    return made;
  }

  /** Several clips at once, those that exist (name → clip). */
  async clips(character: CharacterFile, file: LoadedFile, names: readonly string[]): Promise<Map<string, BakedClip>> {
    const out = new Map<string, BakedClip>();
    const made = await Promise.all(names.map((n) => this.clip(character, file, n)));
    names.forEach((n, i) => { if (made[i]) out.set(n, made[i]!); });
    return out;
  }

  dispose(): void {
    this.baked.clear();
    for (const b of this.benches.values()) b.bench?.dispose();
    this.benches.clear();
  }
}

/** A pause for the page: an idle callback where there is one (≤ 100 ms), else a timer. */
function pause(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => resolve(), { timeout: 100 });
    else setTimeout(resolve, 0);
  });
}

// ── Playing: one Animator per person ─────────────────────────────────────

interface Track {
  clip: BakedClip;
  group: AnimationGroup;
  weight: number;
}

/**
 * Plays a person's clips with cross-fades: play('Walk') fades the clip playing out and Walk in over `fade` s
 * (animation weights; the bones' own pose is the rest under them). update(dt) each frame. once: true plays a
 * clip once and fades back to `then` (default: the clip before).
 */
export class Animator {
  private scene: Scene;
  private bones: Map<string, TransformNode>;
  private name: string;
  private tracks = new Map<string, Track>();
  private fade = FADE_S;
  private target: string | null = null;
  private onceLeft = 0;
  private after: string | null = null;
  private ratio = 1;

  constructor(scene: Scene, bones: Map<string, TransformNode>, name: string) {
    this.scene = scene;
    this.bones = bones;
    this.name = name;
  }

  /** Add (or replace) a clip this person can play. */
  add(clip: BakedClip): void {
    this.tracks.get(clip.name)?.group.dispose();
    this.tracks.set(clip.name, { clip, group: instantiateClip(this.scene, clip, this.bones, `${this.name}_${clip.name}`), weight: 0 });
  }

  has(name: string): boolean {
    return this.tracks.has(name);
  }

  /** The clip fading in or playing (null: none). */
  get current(): string | null {
    return this.target;
  }

  /** Each clip's weight now (tests). */
  weights(): Record<string, number> {
    return Object.fromEntries([...this.tracks].map(([n, t]) => [n, +t.weight.toFixed(3)]));
  }

  /** The clip's group (tests). */
  groupOf(name: string): AnimationGroup | null {
    return this.tracks.get(name)?.group ?? null;
  }

  /** The clip's own speed (m/s) or null. */
  speedOf(name: string): number | null {
    return this.tracks.get(name)?.clip.speed ?? null;
  }

  /** Fade to `name` (false: no such clip, nothing changes). */
  play(name: string, { fade = FADE_S, speed = 1, once = false, then, at }: {
    fade?: number; speed?: number; once?: boolean; then?: string | null;
    /** Start this far into the cycle (0…1), v0.16.0: people at desks don't all move in step. */
    at?: number;
  } = {}): boolean {
    const track = this.tracks.get(name);
    if (!track) return false;
    if (once) {
      this.after = then !== undefined ? then : (this.target !== name ? this.target : null);
      this.onceLeft = track.clip.duration / Math.max(0.05, speed);
      track.group.goToFrame(0);
    } else if (this.target !== name) {
      this.onceLeft = 0;
    }
    this.fade = Math.max(0, fade);
    this.target = name;
    this.setSpeed(speed);
    if (!track.group.isPlaying) this.startTrack(track);
    if (at !== undefined && Number.isFinite(at)) track.group.goToFrame((((at % 1) + 1) % 1) * track.clip.frames);
    if (this.fade === 0) this.step(Infinity);
    return true;
  }

  /** The playing clip's speed ratio. */
  setSpeed(ratio: number): void {
    this.ratio = ratio;
    const t = this.target ? this.tracks.get(this.target) : null;
    if (t) t.group.speedRatio = ratio;
  }

  /** Fade everything out (back to the bones' own pose). */
  stop(fade = FADE_S): void {
    this.target = null;
    this.onceLeft = 0;
    this.fade = Math.max(0, fade);
    if (this.fade === 0) this.step(Infinity);
  }

  update(dt: number): void {
    if (this.onceLeft > 0) {
      this.onceLeft -= dt;
      if (this.onceLeft <= this.fade) {
        this.onceLeft = 0;
        const next = this.after;
        this.after = null;
        if (next && this.tracks.has(next)) this.play(next, { fade: this.fade, speed: 1 });
        else this.stop(this.fade);
      }
    }
    this.step(dt);
  }

  private startTrack(track: Track): void {
    track.group.start(true, track === this.tracks.get(this.target ?? '') ? this.ratio : 1);
    track.group.setWeightForAllAnimatables(track.weight);
  }

  private step(dt: number): void {
    const rate = this.fade > 0 ? dt / this.fade : Infinity;
    for (const [name, t] of this.tracks) {
      const want = name === this.target ? 1 : 0;
      if (t.weight === want) continue;
      t.weight = want > t.weight ? Math.min(want, t.weight + rate) : Math.max(want, t.weight - rate);
      if (t.weight > 0 && !t.group.isPlaying) this.startTrack(t);
      if (t.weight <= 0) {
        t.weight = 0;
        t.group.stop();
        continue;
      }
      t.group.setWeightForAllAnimatables(t.weight);
    }
  }

  dispose(): void {
    for (const t of this.tracks.values()) t.group.dispose();
    this.tracks.clear();
    this.target = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function depth(node: TransformNode): number {
  let d = 0;
  for (let p = node.parent; p; p = p.parent) d++;
  return d;
}

/** A world matrix's rotation (and mirroring): no translation, no scale. */
export function rotationPart(m: Matrix): Matrix {
  const a = m.m;
  const row = (i: number) => {
    const v = new Vector3(a[i], a[i + 1], a[i + 2]);
    const len = v.length() || 1;
    return v.scaleInPlace(1 / len);
  };
  const x = row(0);
  const y = row(4);
  const z = row(8);
  return Matrix.FromValues(x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1);
}

/** A node's world matrix with its ancestors' brought up to date first. */
export function refreshChain(node: TransformNode): void {
  const chain: TransformNode[] = [];
  for (let p: TransformNode | null = node; p; p = p.parent as TransformNode | null) chain.unshift(p);
  for (const p of chain) p.computeWorldMatrix(true);
}
