import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Animation } from '@babylonjs/core/Animations/animation';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { refreshTree } from '../systems/CharacterSystem';
import { alignLimbs, bakeClip, clipBones, holdClip } from '../systems/ClipLibrary';

// v0.16.0: a glTF's __root__ is a MESH that turns and mirrors everything under it (rotation Y π, scaling z −1).
// Rocketbox's clips lay the character down when baking left it out. A chain of bones under such a root, a clip on
// it, baked onto a copy of the same chain: the copy must take exactly the clip's pose.

const CHAIN = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End'];
let engine: NullEngine;
let scene: Scene;
beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); });
afterEach(() => { scene.dispose(); engine.dispose(); });

function figure(name: string) {
  const top = new TransformNode(`${name}_top`, scene);
  const gltfRoot = new Mesh('__root__', scene);
  gltfRoot.parent = top;
  gltfRoot.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
  gltfRoot.scaling.set(1, 1, -1);
  const rig = new TransformNode(`${name}_Rig`, scene);
  rig.parent = gltfRoot;
  rig.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), -Math.PI / 2);
  let parent: TransformNode = rig;
  const bones = new Map<string, TransformNode>();
  CHAIN.forEach((bone, i) => {
    const node = new TransformNode(`mixamorig:${bone}`, scene);
    node.parent = parent;
    // the hips turned like Rocketbox's (the rig lies the bones' frame down), the rest up the chain
    node.rotationQuaternion = i === 0 ? Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2) : Quaternion.Identity();
    node.position.set(0, i === 0 ? 0 : 0.15, i === 0 ? 0.95 : 0);
    bones.set(bone, node);
    parent = node;
  });
  refreshTree(top);
  return { top, bones };
}

describe('baking under a mirrored glTF root (v0.16.0)', () => {
  it('a clip baked onto its own figure gives the clip pose: standing, the head above the hips', () => {
    const src = figure('src');
    const tgt = figure('tgt');
    const lean = Quaternion.RotationAxis(Vector3.Right(), 0.3);
    const group = new AnimationGroup('Idle', scene);
    for (const [bone, keys] of [
      ['Hips', [src.bones.get('Hips')!.rotationQuaternion!, src.bones.get('Hips')!.rotationQuaternion!]],
      ['Spine', [Quaternion.Identity(), lean]],
    ] as const) {
      const anim = new Animation(`${bone}_r`, 'rotationQuaternion', 30, Animation.ANIMATIONTYPE_QUATERNION);
      anim.setKeys([{ frame: 0, value: keys[0] }, { frame: 30, value: keys[1] }]);
      group.addTargetedAnimation(anim, src.bones.get(bone)!);
    }
    const clip = bakeClip(scene, group, src.top, clipBones(src.top), { root: tgt.top, bones: tgt.bones }, 'Idle')!;
    expect(clip).not.toBeNull();

    // the source at the clip's last frame, the copy held there
    for (const t of group.targetedAnimations) (t.target as TransformNode).rotationQuaternion = (t.animation.evaluate(30) as Quaternion).clone();
    refreshTree(src.top);
    holdClip(clip, tgt.bones, clip.frames);
    refreshTree(tgt.top);
    const y = (b: { bones: Map<string, TransformNode> }, k: string) => b.bones.get(k)!.getAbsolutePosition().y;
    expect(y(tgt, 'Head') - y(tgt, 'Hips')).toBeGreaterThan(0.6);
    for (const bone of CHAIN) {
      const a = src.bones.get(bone)!.getAbsolutePosition();
      const b = tgt.bones.get(bone)!.getAbsolutePosition();
      expect(Vector3.Distance(a, b)).toBeLessThan(1e-3);
    }
    const q = tgt.bones.get('Spine')!.rotationQuaternion!;
    expect(Math.abs(Quaternion.Dot(q, lean))).toBeGreaterThan(0.9999);
  });
});

describe('a T-pose character, clips made in an A-pose (v0.16.0)', () => {
  function arm(name: string, hand: Vector3) {
    const top = new TransformNode(name, scene);
    const upper = new TransformNode(name + '_LeftArm', scene);
    upper.parent = top;
    upper.position.set(0.2, 1.4, 0);
    const fore = new TransformNode(name + '_LeftForeArm', scene);
    fore.parent = upper;
    fore.position.copyFrom(hand);
    refreshTree(top);
    return new Map([['LeftArm', upper], ['LeftForeArm', fore]]);
  }
  it("swings the arm's rest to point as the clip's arm does; the same direction is left alone", () => {
    const src = arm('src', new Vector3(0.2, -0.2, 0));
    const tPose = arm('t', new Vector3(0.28, 0, 0));
    const rest = new Map([['LeftArm', Matrix.Identity()]]);
    alignLimbs(rest, tPose, src);
    const along = Vector3.TransformNormal(new Vector3(1, 0, 0), rest.get('LeftArm')!);
    expect(Vector3.Distance(along, new Vector3(1, -1, 0).normalize())).toBeLessThan(1e-3);
    const same = new Map([['LeftArm', Matrix.Identity()]]);
    alignLimbs(same, arm('a', new Vector3(0.3, -0.3, 0)), src);
    expect(same.get('LeftArm')!.equals(Matrix.Identity())).toBe(true);
    // pointing another way altogether (another rig): not touched
    const back = new Map([['LeftArm', Matrix.Identity()]]);
    alignLimbs(back, arm('b', new Vector3(-0.3, 0, 0)), src);
    expect(back.get('LeftArm')!.equals(Matrix.Identity())).toBe(true);
  });
});
