/**
 * RouteLineSystem.ts
 *
 * The route line of "Show route" / "Take me there" (v0.13.4): chevrons on the
 * floor ahead of you (one thin-instanced mesh), and markers (one more): a post
 * with a ring at the stairs to take and at the goal. Two draw calls in all.
 * Not pickable, no collisions, no shadows. NavigationSystem decides where
 * (play/navigation/follow.js routeMarks); this only draws.
 */

import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';

export interface RouteMark { x: number; y: number; z: number; yaw?: number }
export interface RouteMarker { kind: 'stairs' | 'goal'; x: number; y: number; z: number }

/** The route's colour (AHDUS green, bright enough on every floor). */
export const ROUTE_COLOR = '#2fbf71';
const STAIRS_COLOR = new Color4(0.25, 0.55, 0.95, 1);
const GOAL_COLOR = new Color4(0.18, 0.75, 0.44, 1);

/** A flat chevron pointing +Z, about 0.5 m wide and 0.35 m long, lying on the floor. */
function chevronData(): VertexData {
  const w = 0.26; // half width
  const t = 0.11; // arm thickness
  const l = 0.34; // length
  // two arms of a "V" pointing +Z (y up, a few mm thick: one face up)
  const p = [
    -w, 0, 0, -w + t, 0, 0, 0, 0, l, 0, 0, l - t * 1.4,
    w, 0, 0, w - t, 0, 0,
  ];
  // triangles facing up (+Y): left arm (0, 2, 1) (1, 2, 3), right arm (4, 5, 2) (5, 3, 2)
  const indices = [0, 2, 1, 1, 2, 3, 4, 5, 2, 5, 3, 2];
  const normals: number[] = [];
  VertexData.ComputeNormals(p, indices, normals);
  const data = new VertexData();
  data.positions = p;
  data.indices = indices;
  data.normals = normals;
  return data;
}

export class RouteLineSystem {
  private scene: Scene;
  private chevrons: Mesh | null = null;
  private markers: Mesh | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  private material(name: string, color: Color3): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.disableLighting = true;
    m.emissiveColor = color;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.backFaceCulling = false;
    m.zOffset = -2; // over the floor, never flickering into it
    return m;
  }

  private make(): void {
    if (this.chevrons) return;
    const chevrons = new Mesh('route_chevrons', this.scene);
    chevronData().applyToMesh(chevrons);
    chevrons.material = this.material('route_chevron_mat', Color3.FromHexString(ROUTE_COLOR));
    // markers: a ring on the floor and a post with a ball on top, one mesh (coloured per instance)
    const ring = MeshBuilder.CreateTorus('route_ring', { diameter: 0.9, thickness: 0.07, tessellation: 32 }, this.scene);
    ring.position.y = 0.04;
    const post = MeshBuilder.CreateCylinder('route_post', { height: 1.9, diameter: 0.06, tessellation: 10 }, this.scene);
    post.position.y = 0.95;
    const ball = MeshBuilder.CreateSphere('route_ball', { diameter: 0.26, segments: 10 }, this.scene);
    ball.position.y = 1.95;
    const markers = Mesh.MergeMeshes([ring, post, ball], true, true)!;
    markers.name = 'route_markers';
    const mat = this.material('route_marker_mat', Color3.White());
    markers.material = mat;
    for (const m of [chevrons, markers]) {
      m.isPickable = false;
      m.checkCollisions = false;
      m.receiveShadows = false;
      m.doNotSyncBoundingInfo = true;
      m.alwaysSelectAsActiveMesh = true; // thin instances spread over the floor: never culled by one box
      m.metadata = { routeLine: true };
      m.setEnabled(false);
    }
    this.chevrons = chevrons;
    this.markers = markers;
  }

  /** Draw the line: chevrons (x, y, z, yaw) and markers; empty lists hide it. */
  show(chevrons: RouteMark[], markers: RouteMarker[]): void {
    this.make();
    const c = this.chevrons!;
    const m = this.markers!;
    const mats = new Float32Array(Math.max(1, chevrons.length) * 16);
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const tmp = new Matrix();
    chevrons.forEach((p, i) => {
      Quaternion.RotationYawPitchRollToRef(p.yaw ?? 0, 0, 0, q);
      Matrix.ComposeToRef(one, q, new Vector3(p.x, p.y, p.z), tmp);
      tmp.copyToArray(mats, i * 16);
    });
    c.thinInstanceSetBuffer('matrix', chevrons.length ? mats : null, 16, false);
    c.setEnabled(chevrons.length > 0);

    const mm = new Float32Array(Math.max(1, markers.length) * 16);
    const colors = new Float32Array(Math.max(1, markers.length) * 4);
    markers.forEach((p, i) => {
      Matrix.TranslationToRef(p.x, p.y, p.z, tmp);
      tmp.copyToArray(mm, i * 16);
      (p.kind === 'stairs' ? STAIRS_COLOR : GOAL_COLOR).toArray(colors, i * 4);
    });
    m.thinInstanceSetBuffer('matrix', markers.length ? mm : null, 16, false);
    m.thinInstanceSetBuffer('color', markers.length ? colors : null, 4, false);
    m.setEnabled(markers.length > 0);
  }

  hide(): void {
    this.chevrons?.setEnabled(false);
    this.markers?.setEnabled(false);
  }

  /** What is drawn (tests): how many chevrons and markers. */
  get counts(): { chevrons: number; markers: number } {
    return {
      chevrons: this.chevrons?.isEnabled() ? this.chevrons.thinInstanceCount : 0,
      markers: this.markers?.isEnabled() ? this.markers.thinInstanceCount : 0,
    };
  }

  dispose(): void {
    for (const mesh of [this.chevrons, this.markers]) {
      mesh?.material?.dispose();
      mesh?.dispose();
    }
    this.chevrons = null;
    this.markers = null;
  }
}
