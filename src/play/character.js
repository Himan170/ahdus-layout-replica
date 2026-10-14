/**
 * play/character.js
 *
 * Placeholder player character built from simple shapes, with a walk cycle.
 * Harsh's character module can replace this later: Play mode only needs an
 * object with { root, update(dt, speed, flying), setVisible(bool), dispose() }.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

function material(scene, name, hex, specular = 0.05) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(specular, specular, specular);
  return m;
}

/**
 * @param {Scene} scene
 * @param {{ shirt?: string, shadowGenerator?: ShadowGenerator }} [options]
 */
export function createCharacter(scene, options = {}) {
  const mats = {
    shirt: material(scene, 'pc_shirt', options.shirt ?? '#3d6fd6'),
    pants: material(scene, 'pc_pants', '#2c3140'),
    skin: material(scene, 'pc_skin', '#d9a982'),
    hair: material(scene, 'pc_hair', '#2e2119'),
    shoes: material(scene, 'pc_shoes', '#1d1d1f', 0.2),
    eyes: material(scene, 'pc_eyes', '#111111', 0.6),
  };

  const root = new TransformNode('playerCharacter', scene);
  const parts = [];
  const part = (mesh, mat, parent, x, y, z) => {
    mesh.material = mat;
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.receiveShadows = true;
    options.shadowGenerator?.addShadowCaster(mesh, false);
    parts.push(mesh);
    return mesh;
  };
  const pivot = (name, x, y, z) => {
    const p = new TransformNode(name, scene);
    p.parent = root;
    p.position.set(x, y, z);
    return p;
  };

  // Body (local +Z is the direction the character faces)
  part(MeshBuilder.CreateCapsule('pc_torso', { height: 0.72, radius: 0.2 }, scene), mats.shirt, root, 0, 1.2, 0)
    .scaling.set(1.05, 1, 0.62);
  part(MeshBuilder.CreateCylinder('pc_neck', { diameter: 0.11, height: 0.12 }, scene), mats.skin, root, 0, 1.56, 0);
  part(MeshBuilder.CreateSphere('pc_head', { diameter: 0.3, segments: 16 }, scene), mats.skin, root, 0, 1.73, 0);
  part(MeshBuilder.CreateSphere('pc_hair', { diameter: 0.32, segments: 16, slice: 0.55 }, scene), mats.hair, root, 0, 1.75, -0.01);
  part(MeshBuilder.CreateSphere('pc_eyeL', { diameter: 0.04 }, scene), mats.eyes, root, -0.06, 1.75, 0.135);
  part(MeshBuilder.CreateSphere('pc_eyeR', { diameter: 0.04 }, scene), mats.eyes, root, 0.06, 1.75, 0.135);

  // Limbs hang from pivots so they can swing
  const limb = (name, mat, x, y, len, r) => {
    const p = pivot(`${name}_pivot`, x, y, 0);
    part(MeshBuilder.CreateCapsule(name, { height: len, radius: r }, scene), mat, p, 0, -len / 2, 0);
    return p;
  };
  const armL = limb('pc_armL', mats.shirt, -0.28, 1.46, 0.56, 0.06);
  const armR = limb('pc_armR', mats.shirt, 0.28, 1.46, 0.56, 0.06);
  part(MeshBuilder.CreateSphere('pc_handL', { diameter: 0.1 }, scene), mats.skin, armL, 0, -0.6, 0);
  part(MeshBuilder.CreateSphere('pc_handR', { diameter: 0.1 }, scene), mats.skin, armR, 0, -0.6, 0);
  const legL = limb('pc_legL', mats.pants, -0.11, 0.86, 0.82, 0.085);
  const legR = limb('pc_legR', mats.pants, 0.11, 0.86, 0.82, 0.085);
  part(MeshBuilder.CreateBox('pc_shoeL', { width: 0.13, height: 0.08, depth: 0.26 }, scene), mats.shoes, legL, 0, -0.8, 0.05);
  part(MeshBuilder.CreateBox('pc_shoeR', { width: 0.13, height: 0.08, depth: 0.26 }, scene), mats.shoes, legR, 0, -0.8, 0.05);

  let phase = 0;
  let idle = 0;

  return {
    root,
    /**
     * @param {number} dt seconds
     * @param {number} speed horizontal speed in m/s
     * @param {boolean} flying
     */
    update(dt, speed, flying) {
      idle += dt;
      if (flying) {
        // arms out a little, legs together
        armL.rotation.z = armL.rotation.z * 0.8 + 0.5 * 0.2;
        armR.rotation.z = armR.rotation.z * 0.8 - 0.5 * 0.2;
        armL.rotation.x = armR.rotation.x = legL.rotation.x = legR.rotation.x = 0;
        return;
      }
      armL.rotation.z = armL.rotation.z * 0.8 + 0.06 * 0.2;
      armR.rotation.z = armR.rotation.z * 0.8 - 0.06 * 0.2;
      if (speed > 0.1) {
        phase += dt * (4 + speed * 1.2);
        const swing = Math.min(0.75, 0.25 + speed * 0.08);
        legL.rotation.x = Math.sin(phase) * swing;
        legR.rotation.x = -Math.sin(phase) * swing;
        armL.rotation.x = -Math.sin(phase) * swing * 0.8;
        armR.rotation.x = Math.sin(phase) * swing * 0.8;
      } else {
        // ease limbs back to rest, slight breathing
        for (const l of [legL, legR, armL, armR]) l.rotation.x *= 0.8;
        armL.rotation.x += Math.sin(idle * 2) * 0.01;
        armR.rotation.x -= Math.sin(idle * 2) * 0.01;
      }
    },
    setVisible(visible) {
      root.setEnabled(visible);
    },
    dispose() {
      root.dispose(false, false);
      Object.values(mats).forEach((m) => m.dispose());
    },
  };
}
