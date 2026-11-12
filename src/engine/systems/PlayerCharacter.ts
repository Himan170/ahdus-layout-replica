/**
 * PlayerCharacter.ts
 *
 * You, walking through a layout (LayoutEngine's walkthrough mode): the
 * character you chose in AHDUS instead of Preview's blue figure.
 *
 * - createPlayerCharacter copies the character file the way the people at
 *   their desks are copied (CharacterSystem: the same load-once queue, a copy
 *   with its own skeleton, scaled to the person's height).
 * - The walk clip (an animation-only .glb with a Mixamo-named skeleton) is
 *   RETARGETED onto it by bone names (play/people canonicalBoneName, so the
 *   Unreal-style names of rig 'ue' work too): sampled at 30 frames a second,
 *   each bone turned in the character's frame as much as the clip's bone turns
 *   from ITS rest pose (a rest-pose correction, so a skeleton whose bones
 *   point another way still walks), the hips bob scaled to the person's size
 *   and the clip's forward motion taken out (you are moved by the controls).
 * - It plays as fast as you move (play/people walkRatio: no foot sliding);
 *   standing still or flying = the standing pose (play/people STANDING_POSE).
 *   No clip, a clip that can't be loaded or `walk: false` = the standing pose
 *   all the time (the character slides).
 *
 * The result has Preview's character interface (play/character.js):
 * { root, update(dt, speed, flying), setVisible, dispose }, its root at the
 * feet facing +Z, plus the camera height for this person (`eyeHeight`).
 */

import type { Scene } from '@babylonjs/core/scene';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Animation } from '@babylonjs/core/Animations/animation';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import '@babylonjs/core/Animations/animatable';

import {
  canonicalBoneName, clipSpeed, playerEyeHeight, walkRatio, STANDING_POSE, WALK_MIN_SPEED,
} from '../../play/people';
import { copyCharacter, poseBones, refreshTree, restContainer } from './CharacterSystem';
import type { Clothing } from './CharacterSystem';
import type { CharacterFile, CharacterCopy, LoadedFile } from './CharacterSystem';

/** Who walks: their character file, the walk clip, and whether this character may use it. */
export interface PlayerCharacterSpec {
  character: CharacterFile;
  /** v0.16.0: what they wear (play/outfit.js), for a Rocketbox outfit file. */
  clothing?: Clothing | null;
  walkClipUrl?: string | null;
  /** false: never walk (stand and slide), e.g. a character whose skeleton the clip doesn't fit. */
  walk?: boolean;
}

/** Preview's character interface (play/character.js) and what the walkthrough needs to know. */
export interface PlayCharacter {
  root: TransformNode;
  update(dt: number, speed: number, flying: boolean): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  /** The walkthrough camera's height for this person (m). */
  eyeHeight: number;
  kind: 'full';
  /** Is the walk clip playing now? */
  readonly walking: boolean;
  /** The speed of the last update (m/s): the walkthrough's movement (tests). */
  readonly speed: number;
  /** How fast the clip walks at its own speed (m/s); null: no walk (the standing pose). */
  walkSpeed: number | null;
  /** The walk clip as baked onto this character (tests), null without one. */
  walkGroup: AnimationGroup | null;
}

/** The walk clip is sampled this many times a second. */
const SAMPLES_PER_SECOND = 30;

/**
 * The player's character from its file (and the walk clip, if any). Rejects
 * if the character file can't be loaded: the walkthrough keeps its simple figure.
 * @param loadFile  a file through CharacterSystem's load-once queue (engine.characters.loadFile)
 */
export async function createPlayerCharacter(
  scene: Scene, spec: PlayerCharacterSpec, loadFile: (url: string) => Promise<LoadedFile>,
): Promise<PlayCharacter> {
  const { character } = spec;
  const wantsWalk = spec.walk !== false && !!spec.walkClipUrl;
  const [file, clip] = await Promise.all([
    loadFile(character.url),
    wantsWalk
      ? loadFile(spec.walkClipUrl!).catch((err) => {
        console.warn(`[characters] could not load the walk clip ${spec.walkClipUrl}: standing pose`, err?.message ?? err);
        return null;
      })
      : Promise.resolve(null),
  ]);
  if (scene.isDisposed) throw new Error('The scene was closed');

  const copy = copyCharacter(scene, file, character, 'player_character', { player: true }, spec.clothing ?? null);
  const rest = snapshot(copy.bones);
  let walk: BakedWalk | null = null;
  if (clip) {
    try {
      walk = bakeWalk(scene, clip.container, copy);
      if (!walk) console.warn(`[characters] the walk clip doesn't fit ${character.url} (bones by name): standing pose`);
    } catch (err) {
      console.warn('[characters] could not retarget the walk clip: standing pose', (err as Error)?.message ?? err);
      walk = null;
    }
  }
  restore(rest);
  poseBones(copy.root, copy.bones, STANDING_POSE as [string, string, number[]][]);
  const standing = snapshot(copy.bones);
  refreshAll(copy);

  let walking = false;
  let lastSpeed = 0;
  return {
    root: copy.root,
    eyeHeight: playerEyeHeight(character.height ?? 1.75),
    kind: 'full',
    get walking() { return walking; },
    get speed() { return lastSpeed; },
    walkSpeed: walk?.speed ?? null,
    walkGroup: walk?.group ?? null,
    update(_dt, speed, flying) {
      lastSpeed = speed;
      const go = !!walk && !flying && speed >= WALK_MIN_SPEED;
      if (go) {
        const ratio = walkRatio(speed, walk!.speed);
        if (!walking) walk!.group.start(true, ratio);
        walk!.group.speedRatio = ratio;
        walking = true;
      } else if (walking) {
        walk!.group.stop();
        restore(standing);
        walking = false;
      }
    },
    setVisible(visible) {
      copy.root.setEnabled(visible);
    },
    dispose() {
      walk?.group.dispose();
      // materials and textures belong to the file's container (shared with the people at desks): keep them
      copy.root.dispose(false, false);
      for (const s of copy.skeletons) s.dispose();
    },
  };
}

// ── Retargeting the walk clip ────────────────────────────────────────────

export interface BakedWalk {
  /** One cycle on the character's bones, looping (frames = samples). */
  group: AnimationGroup;
  /** How fast it walks at its own speed (m/s, the character's size). */
  speed: number;
}

/**
 * The walk clip of `clip` (its first animation) baked onto the character's
 * bones; null if the two skeletons share too few bones (by name). The clip's
 * nodes are copied for the sampling and removed again; the character is left
 * in whatever pose the last sample gave (restore it afterwards).
 */
export function bakeWalk(scene: Scene, clip: AssetContainer, target: Pick<CharacterCopy, 'root' | 'bones'>): BakedWalk | null {
  restContainer(clip); // the clip's rest pose, not a frame of its walk (else the arms stayed straight out)
  const src = clip.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  const top = new TransformNode('walk_clip', scene);
  for (const n of src.rootNodes) n.parent = top;
  try {
    const group = src.animationGroups[0];
    if (!group) return null;
    group.stop();
    const srcBones = bonesByName(top);
    return bakeGroup(scene, group, top, srcBones, target);
  } finally {
    for (const g of src.animationGroups) g.dispose();
    for (const s of src.skeletons) s.dispose();
    top.dispose(false, false);
  }
}

/**
 * The sampling and retargeting itself (exported for tests): `group` animates
 * the nodes under `top`, `srcBones` = those nodes by Mixamo name.
 */
export function bakeGroup(
  scene: Scene, group: AnimationGroup, top: TransformNode, srcBones: Map<string, TransformNode>,
  target: Pick<CharacterCopy, 'root' | 'bones'>,
): BakedWalk | null {
  const pairs = [...target.bones]
    .filter(([key, node]) => srcBones.has(key) && node.parent instanceof TransformNode)
    .sort((a, b) => depth(a[1]) - depth(b[1]));
  if (pairs.length < 6 || !pairs.some(([key]) => key === 'Hips')) return null;
  const animations = group.targetedAnimations;
  if (!animations.length) return null;
  const fps = animations[0].animation.framePerSecond || 60;
  const duration = (group.to - group.from) / fps;
  if (!(duration > 0)) return null;
  const n = Math.min(120, Math.max(8, Math.round(duration * SAMPLES_PER_SECOND)));

  // Rest poses: the clip's (as its file has it) and the character's
  refreshTree(top);
  refreshTree(target.root);
  const srcRest = new Map(pairs.map(([key]) => [key, rotationPart(srcBones.get(key)!.getWorldMatrix())]));
  const tgtRest = new Map(pairs.map(([key, node]) => [key, rotationPart(node.getWorldMatrix())]));
  const srcHips = srcBones.get('Hips')!;
  const tgtHips = target.bones.get('Hips')!;
  const srcHipsRest = srcHips.getAbsolutePosition().clone();
  const tgtHipsRest = tgtHips.getAbsolutePosition().clone();
  const ground = Math.min(...[...srcBones.values()].map((b) => b.getAbsolutePosition().y));
  const feetY = target.root.getAbsolutePosition().y;
  const size = (tgtHipsRest.y - feetY) / Math.max(1e-3, srcHipsRest.y - ground); // character / clip

  // Sample the clip: each bone's rotation in the clip's frame, the hips and a foot
  const worlds: Map<string, Matrix>[] = [];
  const hips: Vector3[] = [];
  const foot: number[] = [];
  const srcFoot = srcBones.get('LeftFoot');
  for (let i = 0; i <= n; i++) {
    const frame = group.from + ((group.to - group.from) * i) / n;
    for (const { animation, target: node } of animations) {
      const value = animation.evaluate(frame);
      (node as Record<string, unknown>)[animation.targetProperty] = value?.clone ? value.clone() : value;
    }
    refreshTree(top);
    worlds.push(new Map(pairs.map(([key]) => [key, rotationPart(srcBones.get(key)!.getWorldMatrix())])));
    const h = srcHips.getAbsolutePosition().clone();
    hips.push(h);
    if (srcFoot) foot.push(srcFoot.getAbsolutePosition().z - h.z);
  }
  const travel = hips[n].z - hips[0].z;
  const drift = hips[n].x - hips[0].x;
  const footRange = foot.length ? Math.max(...foot) - Math.min(...foot) : 0;
  const speed = clipSpeed({ duration, hipsTravel: travel, footRange }) * size;
  if (!(speed > 0)) return null;

  // Bake: the character's bones turned as much (in its frame) as the clip's turn from their rest pose
  const keys = new Map<string, { frame: number; value: Quaternion }[]>(pairs.map(([key]) => [key, []]));
  const hipsKeys: { frame: number; value: Vector3 }[] = [];
  for (let i = 0; i <= n; i++) {
    for (const [key, node] of pairs) {
      const turn = Matrix.Invert(srcRest.get(key)!).multiply(worlds[i].get(key)!);
      const want = tgtRest.get(key)!.multiply(turn);
      const parent = node.parent as TransformNode;
      refreshChain(parent);
      const local = want.multiply(Matrix.Invert(rotationPart(parent.getWorldMatrix())));
      const q = Quaternion.FromRotationMatrix(local).normalize();
      node.rotationQuaternion = q;
      keys.get(key)!.push({ frame: i, value: q.clone() });
      if (key === 'Hips') {
        // the bob and sway, the clip's forward motion taken out (the controls move you)
        const d = hips[i].subtract(hips[0]);
        d.x -= (drift * i) / n;
        d.z -= (travel * i) / n;
        d.y = hips[i].y - srcHipsRest.y;
        const world = tgtHipsRest.add(d.scale(size));
        const local = Vector3.TransformCoordinates(world, Matrix.Invert(parent.getWorldMatrix()));
        node.position.copyFrom(local);
        hipsKeys.push({ frame: i, value: local.clone() });
      }
      node.computeWorldMatrix(true);
    }
  }

  const baked = new AnimationGroup('player_walk', scene);
  for (const [key, node] of pairs) {
    const anim = new Animation(`player_walk_${key}`, 'rotationQuaternion', n / duration,
      Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);
    anim.setKeys(keys.get(key)!);
    baked.addTargetedAnimation(anim, node);
  }
  const hipsAnim = new Animation('player_walk_hips', 'position', n / duration,
    Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
  hipsAnim.setKeys(hipsKeys);
  baked.addTargetedAnimation(hipsAnim, tgtHips);
  baked.normalize(0, n);
  return { group: baked, speed };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** The nodes under `top` by Mixamo name (Mixamo or Unreal-style names). */
function bonesByName(top: TransformNode): Map<string, TransformNode> {
  const bones = new Map<string, TransformNode>();
  for (const node of top.getDescendants(false)) {
    if (!(node instanceof TransformNode)) continue;
    const key = canonicalBoneName(node.name, 'mixamo') ?? canonicalBoneName(node.name, 'ue');
    if (key && !bones.has(key)) bones.set(key, node);
  }
  return bones;
}

function depth(node: TransformNode): number {
  let d = 0;
  for (let p = node.parent; p; p = p.parent) d++;
  return d;
}

/** A world matrix's rotation (and mirroring): no translation, no scale. */
function rotationPart(m: Matrix): Matrix {
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
function refreshChain(node: TransformNode): void {
  const chain: TransformNode[] = [];
  for (let p: TransformNode | null = node; p; p = p.parent as TransformNode | null) chain.unshift(p);
  for (const p of chain) p.computeWorldMatrix(true);
}

function refreshAll(copy: Pick<CharacterCopy, 'root' | 'meshes'>): void {
  refreshTree(copy.root);
  for (const m of copy.meshes) m.refreshBoundingInfo({ applySkeleton: true });
}

type Snapshot = [TransformNode, Quaternion, Vector3][];

function snapshot(bones: Map<string, TransformNode>): Snapshot {
  return [...bones.values()].map((node) => {
    node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
    return [node, node.rotationQuaternion.clone(), node.position.clone()];
  });
}

function restore(s: Snapshot): void {
  for (const [node, q, p] of s) {
    node.rotationQuaternion = q.clone();
    node.position.copyFrom(p);
  }
}
