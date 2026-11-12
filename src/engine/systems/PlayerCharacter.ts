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
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import '@babylonjs/core/Animations/animatable';

import {
  playerEyeHeight, walkRatio, STANDING_POSE, WALK_MIN_SPEED,
} from '../../play/people';
import { copyCharacter, poseBones, refreshTree, restContainer } from './CharacterSystem';
import type { Clothing } from './CharacterSystem';
import { bakeClip, clipBones, instantiateClip } from './ClipLibrary';
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
