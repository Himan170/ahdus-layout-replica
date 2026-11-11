/**
 * HighlightSystem.ts
 *
 * Outlines rooms and items in a colour of their own (LayoutEngine.highlight:
 * training, explanations, search results). The same look as a selected room
 * (its walls and floor, also a wall it shares with a neighbour, which the
 * neighbour may build) and as Preview's aimed item (an item gets a mesh of
 * its own while outlined: assetInstances.setItemLook). Works on the meshes of
 * a RoomSystem and an ObjectSystem; apply() again after they sync.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

import { setItemLook } from '../../utils/assetInstances';
import type { RoomSystem } from './RoomSystem';
import type { ObjectSystem } from './ObjectSystem';

const OUTLINE_WIDTH = { room: 0.06, item: 0.03 };
const TINT_ALPHA = 0.45;

/** The meshes of an item that have something to outline. */
const itemMeshes = (root: TransformNode) => [root, ...root.getChildMeshes(false)]
  .filter((m): m is AbstractMesh => (m as AbstractMesh).getTotalVertices?.() > 0);

export class HighlightSystem {
  /** room or item id → its highlight colour */
  private colors = new Map<string, string>();
  /** item ids that are also tinted (Studio's group selection, v0.15.5: an outline alone is too thin from above) */
  private tinted = new Set<string>();
  /** item roots that have the 'highlight' look now */
  private lit = new Set<TransformNode>();
  private rooms: RoomSystem;
  private objects: ObjectSystem;

  constructor(rooms: RoomSystem, objects: ObjectSystem) {
    this.rooms = rooms;
    this.objects = objects;
  }

  /** The ids highlighted now. */
  ids(): string[] {
    return [...this.colors.keys()];
  }

  /** Highlight these rooms / items (others keep theirs) and apply it. */
  add(ids: string[], color: string, options: { tint?: boolean } = {}): void {
    for (const id of ids) {
      this.colors.set(id, color);
      if (options.tint) this.tinted.add(id);
    }
    this.apply();
  }

  /**
   * Remove every highlight. Room outlines go back to the selection's at the
   * next RoomSystem.sync (it sets every wall's and floor's outline).
   */
  clear(): void {
    for (const root of this.lit) this.unlight(root);
    this.lit.clear();
    this.colors.clear();
    this.tinted.clear();
  }

  /** Apply the highlights to the current meshes (after the systems synced). */
  apply(): void {
    for (const node of this.rooms.meshes.values()) {
      for (const child of node.getChildMeshes(false)) {
        const { part, roomId, sharedWith } = child.metadata ?? {};
        if (part !== 'wall' && part !== 'floor') continue;
        const color = this.colors.get(roomId) ?? (sharedWith ? this.colors.get(sharedWith) : undefined);
        if (!color) continue;
        child.renderOutline = true;
        child.outlineColor = Color3.FromHexString(color);
        child.outlineWidth = OUTLINE_WIDTH.room;
      }
    }

    for (const root of [...this.lit]) {
      if (root.isDisposed()) this.lit.delete(root);
    }
    for (const [id, root] of this.objects.meshes) {
      const color = this.colors.get(id);
      if (!color) {
        if (this.lit.has(root)) {
          this.unlight(root);
          this.lit.delete(root);
        }
        continue;
      }
      setItemLook(root, 'highlight', true); // instances can't have an outline of their own
      this.lit.add(root);
      const tint = this.tinted.has(id);
      for (const m of itemMeshes(root)) {
        m.renderOutline = true;
        m.outlineColor = Color3.FromHexString(color);
        m.outlineWidth = OUTLINE_WIDTH.item;
        // a tint, unless the item has one already (a locked item keeps its lock tint)
        if (tint && !m.renderOverlay) {
          m.renderOverlay = true;
          m.overlayColor = Color3.FromHexString(color);
          m.overlayAlpha = TINT_ALPHA;
          m.metadata = { ...(m.metadata ?? {}), highlightTint: m.overlayColor.toHexString() };
        }
      }
    }
  }

  private unlight(root: TransformNode): void {
    if (root.isDisposed()) return;
    for (const m of itemMeshes(root)) {
      m.renderOutline = false;
      if (m.metadata?.highlightTint) {
        // only our own tint: a lock tint set since then stays
        if (m.overlayColor?.toHexString() === m.metadata.highlightTint) m.renderOverlay = false;
        const { highlightTint: _drop, ...rest } = m.metadata;
        m.metadata = rest;
      }
    }
    setItemLook(root, 'highlight', false); // back to a cheap instance (unless locked)
  }
}
