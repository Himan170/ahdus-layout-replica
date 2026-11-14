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
 * v0.16.0: a character with clips (its clip set, or its own file's: the shared ClipLibrary) stands in its Idle,
 * walks, runs from RUN_FROM (Shift; play/people chooseGait), cross-fading between them, lifts its feet on stairs
 * (play/people stairLift: the forward leg bent more, after the clips are applied) and waves (wave(), the H key:
 * standing still only). Without clips, the walk clip of v0.12 as before.
 *
 * The result has Preview's character interface (play/character.js):
 * { root, update(dt, speed, flying), setVisible, dispose }, its root at the
 * feet facing +Z, plus the camera height for this person (`eyeHeight`).
 */

import type { Scene } from '@babylonjs/core/scene';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import '@babylonjs/core/Animations/animatable';

import {
  playerEyeHeight, walkRatio, STANDING_POSE, WALK_MIN_SPEED, chooseGait, stairLift, STAIR_HIP_LIFT,
} from '../../play/people';
import { copyCharacter, poseBones, refreshTree, restContainer, skipSkinnedBounds } from './CharacterSystem';
import type { Clothing } from './CharacterSystem';
import { bakeClip, clipBones, instantiateClip, Animator, refreshChain } from './ClipLibrary';
import type { BakedClip, ClipLibrary } from './ClipLibrary';
import type { Observer } from '@babylonjs/core/Misc/observable';
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
  /**
   * `ctx.climb`: how fast the ground under you rises (m/s; stairs), v0.16.0. `ctx.gait` (v0.16.1, a live
   * person): the clip they play ('Idle' | 'Walk' | 'Run'), as their own browser says, instead of from the speed.
   */
  update(dt: number, speed: number, flying: boolean, ctx?: { climb?: number; gait?: string | null }): void;
  /** v0.16.0: wave (the H key): false = can't now (moving, or no Wave clip). */
  wave?(): boolean;
  /** v0.16.0: the clip playing ('Idle', 'Walk', 'Run', 'Wave'), null: none (the standing pose). */
  readonly gait?: string | null;
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


/**
 * The player's character from its file (and the walk clip, if any). Rejects
 * if the character file can't be loaded: the walkthrough keeps its simple figure.
 * @param loadFile  a file through CharacterSystem's load-once queue (engine.characters.loadFile)
 */
export async function createPlayerCharacter(
  scene: Scene, spec: PlayerCharacterSpec, loadFile: (url: string) => Promise<LoadedFile>,
  library: ClipLibrary | null = null,
): Promise<PlayCharacter> {
  const { character } = spec;
  const wantsWalk = spec.walk !== false && !!spec.walkClipUrl;
  // v0.16.0: the character's own clips (its clip set or its file), through the shared library
  if (library && spec.walk !== false) {
    const file = await loadFile(character.url);
    const clips = await library.clips(character, file, PLAYER_CLIPS);
    if (scene.isDisposed) throw new Error('The scene was closed');
    if (clips.has('Walk')) return animatedCharacter(scene, file, spec, clips);
  }
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

// ── v0.16.0: a character with its clips ─────────────────────────────────

/** The clips your character plays (and a live person's, v0.16.1). */
export const PLAYER_CLIPS = ['Idle', 'Walk', 'Run', 'Wave'];

/**
 * A walking character with its clips: you (createPlayerCharacter), or v0.16.1 someone else on the page
 * (LiveSystem: `name` = live_<id>, `metadata` = { livePersonId }).
 */
export function animatedCharacter(scene: Scene, file: LoadedFile, spec: PlayerCharacterSpec, clips: Map<string, BakedClip>,
  { name = 'player_character', metadata = { player: true } as Record<string, unknown> } = {}): PlayCharacter {
  const { character } = spec;
  const copy = copyCharacter(scene, file, character, name, metadata, spec.clothing ?? null);
  // the standing pose under the clips (what a fading clip blends with)
  poseBones(copy.root, copy.bones, STANDING_POSE as [string, string, number[]][]);
  refreshAll(copy);
  const animator = new Animator(scene, copy.allBones, name === 'player_character' ? 'player' : name);
  for (const clip of clips.values()) animator.add(clip);
  const has = { walk: animator.has('Walk'), run: animator.has('Run') };
  const idle = () => (animator.has('Idle') ? animator.play('Idle') : animator.stop());
  if (animator.has('Idle')) animator.play('Idle', { fade: 0 });
  const legs = legsOf(copy);
  let gait = 'Idle';
  let lift = 0;
  let lastSpeed = 0;
  const observer: Observer<Scene> | null = scene.onAfterAnimationsObservable.add(() => {
    if (lift > 0.02 && gait !== 'Idle' && copy.root.isEnabled()) liftLegs(copy, legs, lift);
  });
  return {
    root: copy.root,
    eyeHeight: playerEyeHeight(character.height ?? 1.75),
    kind: 'full',
    get walking() { return gait !== 'Idle'; },
    get speed() { return lastSpeed; },
    get gait() { return animator.current; },
    walkSpeed: animator.speedOf('Walk'),
    walkGroup: animator.groupOf('Walk'),
    update(dt, speed, flying, ctx) {
      lastSpeed = speed;
      const asked = ctx?.gait; // a live person: what their own browser says they do
      const want = asked === 'Idle' ? 'Idle' : asked === 'Walk' || asked === 'Run' ? chooseGait(asked === 'Run' ? 99 : 1, false, has)
        : chooseGait(speed, flying, has);
      lift += (stairLift(ctx?.climb ?? 0) - lift) * Math.min(1, dt * 8); // eased: a step onto a floor is one frame
      if (want !== gait) {
        gait = want;
        if (want === 'Idle') idle();
        else animator.play(want);
      }
      if (gait !== 'Idle') animator.setSpeed(walkRatio(speed, animator.speedOf(gait) ?? speed));
      animator.update(dt);
    },
    wave() {
      if (gait !== 'Idle' || !animator.has('Wave')) return false;
      if (animator.current !== 'Wave') animator.play('Wave', { once: true, then: animator.has('Idle') ? 'Idle' : null });
      return true;
    },
    setVisible(visible) {
      copy.root.setEnabled(visible);
    },
    dispose() {
      scene.onAfterAnimationsObservable.remove(observer);
      animator.dispose();
      copy.root.dispose(false, false);
      for (const s of copy.skeletons) s.dispose();
    },
  };
}

/** A leg for lifting the feet on stairs: its bones and which way turns them forward (found on the copy). */
export interface Leg {
  thigh: TransformNode;
  knee: TransformNode;
  foot: TransformNode;
  hipSign: number;
  kneeSign: number;
}

/** Turn a node about a world axis (in its parent's frame, after its own rotation). */
function turnAbout(node: TransformNode, axisWorld: Vector3, angle: number): void {
  const parent = node.parent as TransformNode;
  refreshChain(parent);
  const inv = parent.getWorldMatrix().clone().invert();
  const axis = Vector3.TransformNormal(axisWorld, inv).normalize();
  node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
  node.rotationQuaternion = Quaternion.RotationAxis(axis, angle).multiply(node.rotationQuaternion);
}

function sideAxes(copy: Pick<CharacterCopy, 'root'>): { forward: Vector3; right: Vector3 } {
  copy.root.computeWorldMatrix(true);
  const w = copy.root.getWorldMatrix();
  return {
    forward: Vector3.TransformNormal(new Vector3(0, 0, 1), w).normalize(),
    right: Vector3.TransformNormal(new Vector3(1, 0, 0), w).normalize(),
  };
}

/** Both legs, with the sign that swings the thigh forward and bends the knee backward (tried once on the copy). */
export function legsOf(copy: Pick<CharacterCopy, 'root' | 'bones'>): Leg[] {
  const legs: Leg[] = [];
  const { forward, right } = sideAxes(copy);
  for (const side of ['Left', 'Right']) {
    const thigh = copy.bones.get(side + 'UpLeg');
    const knee = copy.bones.get(side + 'Leg');
    const foot = copy.bones.get(side + 'Foot');
    if (!thigh || !knee || !foot) continue;
    const tryTurn = (node: TransformNode, moved: TransformNode) => {
      node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
      const keep = node.rotationQuaternion.clone();
      refreshChain(moved);
      const before = moved.getAbsolutePosition().clone();
      turnAbout(node, right, 0.3);
      refreshChain(moved);
      const d = moved.getAbsolutePosition().subtract(before);
      node.rotationQuaternion = keep;
      refreshChain(moved);
      return Vector3.Dot(d, forward);
    };
    const hipSign = tryTurn(thigh, knee) >= 0 ? 1 : -1;
    const kneeSign = tryTurn(knee, foot) <= 0 ? 1 : -1;
    legs.push({ thigh, knee, foot, hipSign, kneeSign });
  }
  return legs;
}

/**
 * On stairs: the leg swinging forward is lifted (more hip and knee bend), so the foot clears the step. `lift` 0…1.
 * Runs after the clips are applied each frame (they set the bones again next frame).
 */
export function liftLegs(copy: Pick<CharacterCopy, 'root' | 'bones'>, legs: Leg[], lift: number): void {
  const { forward, right } = sideAxes(copy);
  for (const leg of legs) {
    refreshChain(leg.knee);
    const dir = leg.knee.getAbsolutePosition().subtract(leg.thigh.getAbsolutePosition()).normalize();
    const swing = Math.min(1, Math.max(0, (Vector3.Dot(dir, forward) + 0.05) / 0.35));
    const bend = lift * STAIR_HIP_LIFT * swing;
    if (bend <= 0) continue;
    turnAbout(leg.thigh, right, leg.hipSign * bend);
    turnAbout(leg.knee, right, leg.kneeSign * 2 * bend);
  }
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
    const srcBones = clipBones(top);
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
  target: Pick<CharacterCopy, 'root' | 'bones'> & { allBones?: Map<string, TransformNode> },
): BakedWalk | null {
  const clip = bakeClip(scene, group, top, srcBones, target, 'Walk');
  if (!clip?.speed) return null;
  const baked = instantiateClip(scene, clip, target.allBones ?? target.bones, 'player_walk');
  return { group: baked, speed: clip.speed };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function refreshAll(copy: Pick<CharacterCopy, 'root' | 'meshes'>): void {
  refreshTree(copy.root);
  skipSkinnedBounds(copy.meshes); // v0.17.0: no CPU skinning for its box (it walks out of any box anyway)
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
