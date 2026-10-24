/**
 * utils/floorPlanExporter.js
 *
 * Pure-canvas 2D floor plan renderer for PNG and PDF export.
 * Reads from the workspace store data model and draws an offscreen canvas —
 * no Babylon.js, no live viewport dependency.
 *
 * Data model conventions (from engine/model/schema.ts):
 *   - Room {x, z}: centre; width along X, depth along Z.
 *   - Walls: north = +Z edge, south = -Z, east = +X, west = -X.
 *   - Opening offset: from the wall centre, along the wall axis.
 *
 * Coordinate conventions for the 2D canvas:
 *   - We map X → canvas X, Z → canvas Y (so north is up on screen).
 *   - This matches the "top-down" view the editor normally shows.
 */

import { WALL_THICKNESS, roomOpenings } from '../play/geometry';
import { ROOM_TYPES } from './roomStore';
import { ASSET_TYPES } from './assetCatalog';

// ── Drawing constants ─────────────────────────────────────────────────────

const MARGIN_PX = 120;        // includes the scaled dimension annotations
const BASE_SCALE = 60;        // pixels per metre at 1× — upscaled by SCALE_FACTOR
const SCALE_FACTOR = 3;       // total px/m = BASE_SCALE × SCALE_FACTOR = 180
const PIXELS_PER_METER = BASE_SCALE * SCALE_FACTOR;
const MAX_CANVAS_DIM = 8192;  // cap canvas size to stay within GPU/browser limits

const WALL_COLOR    = '#1a1a2e';
const WALL_STROKE   = 2.5;
const DOOR_COLOR    = '#1a1a2e';
const DOOR_FILL     = '#ffffff';
const WINDOW_COLOR  = '#5a8fd4';
const WINDOW_FILL   = '#c5dff5';
const DIM_COLOR     = '#555577';
const DIM_FONT_SIZE = 11;     // px (device-pixel, before canvas scale)
const LABEL_FONT_SIZE = 13;
const TITLE_FONT_SIZE = 15;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Convert room-world meters to canvas pixels (given the transform origin). */
function toCanvas(worldX, worldZ, tx, ty, pxPerM = PIXELS_PER_METER) {
  return {
    cx: tx + worldX * pxPerM,
    cy: ty - worldZ * pxPerM, // Z flipped: +Z is "up" in world → top of canvas
  };
}

/** Keep room fills light enough for legible labels, but visibly preserve their colour. */
function roomFill(color) {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color : '#8899aa';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const blend = (v) => Math.round(v + (255 - v) * 0.35);
  return `rgba(${blend(r)},${blend(g)},${blend(b)},0.8)`;
}

/** Hex colour for a room type from the catalogue (falls back to a neutral grey). */
function typeColor(room) {
  return ROOM_TYPES[room.type]?.color ?? '#8899aa';
}

// ── Compute bounding box of all rooms on a floor ──────────────────────────

function floorBounds(rooms, objects) {
  if (!rooms.length && !objects.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.x - r.width / 2);
    maxX = Math.max(maxX, r.x + r.width / 2);
    minZ = Math.min(minZ, r.z - r.depth / 2);
    maxZ = Math.max(maxZ, r.z + r.depth / 2);
  }
  for (const object of objects) {
    const asset = ASSET_TYPES[object.assetType];
    if (!asset) continue;
    const width = asset.defaultWidth * Math.abs(object.scaleX ?? 1);
    const depth = asset.defaultDepth * Math.abs(object.scaleZ ?? 1);
    const rotation = object.rotationY ?? 0;
    const halfW = (Math.abs(Math.cos(rotation)) * width + Math.abs(Math.sin(rotation)) * depth) / 2;
    const halfD = (Math.abs(Math.sin(rotation)) * width + Math.abs(Math.cos(rotation)) * depth) / 2;
    minX = Math.min(minX, object.x - halfW);
    maxX = Math.max(maxX, object.x + halfW);
    minZ = Math.min(minZ, object.z - halfD);
    maxZ = Math.max(maxZ, object.z + halfD);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minZ, maxZ, w: maxX - minX, h: maxZ - minZ };
}

// ── Door arc helper ───────────────────────────────────────────────────────

/**
 * Draw a door:  a filled rectangle (threshold) + a quarter-circle sweep arc.
 * `wallAxis`: 'x' if the wall runs along X, 'z' if along Z.
 * The arc swings into the room interior.
 */
function drawDoor(ctx, opening, room, tx, ty, pxPerM, detailScale) {
  const { wall, offset, width } = opening;
  const T  = WALL_THICKNESS;
  const cx = room.x;
  const cz = room.z;

  // Wall centre in world coords
  const wallCentre = {
    north: { wx: cx,         wz: cz + room.depth / 2 },
    south: { wx: cx,         wz: cz - room.depth / 2 },
    east:  { wx: cx + room.width / 2, wz: cz },
    west:  { wx: cx - room.width / 2, wz: cz },
  }[wall];

  const { wx: wcx, wz: wcz } = wallCentre;
  const alongX = wall === 'north' || wall === 'south';

  // Pivot of the door (hinge) in world space
  const pivotX = alongX ? wcx + offset - width / 2 : wcx;
  const pivotZ = alongX ? wcz : wcz + offset - width / 2;

  // Tip of the door panel (the end of the arc) in world space
  const tipX = alongX ? pivotX + width : pivotX;
  const tipZ = alongX ? pivotZ : pivotZ + width;

  const p  = toCanvas(pivotX, pivotZ, tx, ty, pxPerM);
  const t  = toCanvas(tipX, tipZ, tx, ty, pxPerM);
  const wPx = width * pxPerM;

  // Blank the wall opening (white rectangle over the wall)
  ctx.save();
  ctx.fillStyle = '#ffffff';
  if (alongX) {
    const ox = toCanvas(pivotX, pivotZ, tx, ty, pxPerM);
    ctx.fillRect(ox.cx, ox.cy - T * pxPerM, wPx, T * pxPerM * 2);
  } else {
    const oz = toCanvas(pivotX, pivotZ, tx, ty, pxPerM);
    ctx.fillRect(oz.cx - T * pxPerM, oz.cy - wPx, T * pxPerM * 2, wPx);
  }
  ctx.restore();

  // Door panel line + arc
  ctx.save();
  ctx.strokeStyle = DOOR_COLOR;
  ctx.fillStyle   = DOOR_FILL;
  ctx.lineWidth   = 1.5 * detailScale;
  ctx.globalAlpha = 0.9;

  // Draw thin door panel
  ctx.beginPath();
  ctx.moveTo(p.cx, p.cy);
  ctx.lineTo(t.cx, t.cy);
  ctx.stroke();

  // Quarter-circle sweep into the room
  let startAngle, endAngle;
  const intoRoom = (wall === 'north') ? 1 : (wall === 'south') ? -1 : 0;
  const intoRoomZ = (wall === 'east') ? 1 : (wall === 'west') ? -1 : 0;

  if (alongX) {
    const base = Math.atan2(t.cy - p.cy, t.cx - p.cx);
    // Interior is toward room centre; north wall sweeps "down" (positive cy), south "up"
    endAngle   = base;
    startAngle = (wall === 'north') ? base + Math.PI / 2 : base - Math.PI / 2;
  } else {
    const base = Math.atan2(t.cy - p.cy, t.cx - p.cx);
    endAngle   = base;
    startAngle = (wall === 'east') ? base + Math.PI / 2 : base - Math.PI / 2;
  }

  ctx.beginPath();
  ctx.moveTo(p.cx, p.cy);
  ctx.arc(p.cx, p.cy, wPx, startAngle, endAngle, false);
  ctx.closePath();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle   = DOOR_COLOR;
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = DOOR_COLOR;
  ctx.lineWidth   = detailScale;
  ctx.stroke();

  ctx.restore();
}

// ── Window helper ─────────────────────────────────────────────────────────

function drawWindow(ctx, opening, room, tx, ty, pxPerM, detailScale) {
  const { wall, offset, width } = opening;
  const T   = WALL_THICKNESS;
  const cx  = room.x;
  const cz  = room.z;

  const wallCentre = {
    north: { wx: cx,              wz: cz + room.depth / 2 },
    south: { wx: cx,              wz: cz - room.depth / 2 },
    east:  { wx: cx + room.width / 2, wz: cz },
    west:  { wx: cx - room.width / 2, wz: cz },
  }[wall];

  const { wx: wcx, wz: wcz } = wallCentre;
  const alongX = wall === 'north' || wall === 'south';

  ctx.save();
  ctx.fillStyle   = WINDOW_FILL;
  ctx.strokeStyle = WINDOW_COLOR;
  ctx.lineWidth   = 1.5 * detailScale;

  if (alongX) {
    const sx = toCanvas(wcx + offset - width / 2, wcz, tx, ty, pxPerM);
    const wPx = width * pxPerM;
    const tPx = T * pxPerM;
    ctx.fillRect(sx.cx, sx.cy - tPx, wPx, tPx * 2);
    ctx.strokeRect(sx.cx, sx.cy - tPx, wPx, tPx * 2);
    // Centre line
    ctx.beginPath();
    ctx.moveTo(sx.cx, sx.cy);
    ctx.lineTo(sx.cx + wPx, sx.cy);
    ctx.strokeStyle = WINDOW_COLOR;
    ctx.lineWidth   = detailScale;
    ctx.stroke();
  } else {
    const sz = toCanvas(wcx, wcz + offset - width / 2, tx, ty, pxPerM);
    const wPx = width * pxPerM;
    const tPx = T * pxPerM;
    ctx.fillRect(sz.cx - tPx, sz.cy - wPx, tPx * 2, wPx);
    ctx.strokeRect(sz.cx - tPx, sz.cy - wPx, tPx * 2, wPx);
    ctx.beginPath();
    ctx.moveTo(sz.cx, sz.cy);
    ctx.lineTo(sz.cx, sz.cy - wPx);
    ctx.strokeStyle = WINDOW_COLOR;
    ctx.lineWidth   = detailScale;
    ctx.stroke();
  }
  ctx.restore();
}

// ── Dimension arrow helper ────────────────────────────────────────────────

function drawDimension(ctx, x1, y1, x2, y2, label, side = 1, detailScale = 1) {
  const dx   = x2 - x1;
  const dy   = y2 - y1;
  const len  = Math.hypot(dx, dy);
  if (len < 2) return;

  const nx = -dy / len * side;  // normal (perpendicular), direction = `side`
  const ny =  dx / len * side;
  const off = 18 * detailScale; // offset from the wall

  const ax1 = x1 + nx * off;
  const ay1 = y1 + ny * off;
  const ax2 = x2 + nx * off;
  const ay2 = y2 + ny * off;

  ctx.save();
  ctx.strokeStyle = DIM_COLOR;
  ctx.fillStyle   = DIM_COLOR;
  ctx.lineWidth   = detailScale;
  ctx.font        = `${DIM_FONT_SIZE * detailScale}px Inter, system-ui, sans-serif`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';

  // Main line
  ctx.beginPath();
  ctx.moveTo(ax1, ay1);
  ctx.lineTo(ax2, ay2);
  ctx.stroke();

  // Tick marks
  const tickLen = 5 * detailScale;
  ctx.beginPath();
  ctx.moveTo(ax1 + nx * (-tickLen), ay1 + ny * (-tickLen));
  ctx.lineTo(ax1 + nx * tickLen, ay1 + ny * tickLen);
  ctx.moveTo(ax2 + nx * (-tickLen), ay2 + ny * (-tickLen));
  ctx.lineTo(ax2 + nx * tickLen, ay2 + ny * tickLen);
  ctx.stroke();

  // Label
  const mx = (ax1 + ax2) / 2 + nx * (DIM_FONT_SIZE + 2) * detailScale;
  const my = (ay1 + ay2) / 2 + ny * (DIM_FONT_SIZE + 2) * detailScale;
  const angle = Math.atan2(dy, dx);
  ctx.translate(mx, my);
  ctx.rotate(angle);
  ctx.fillText(label, 0, 0);

  ctx.restore();
}

// ── Main export function ──────────────────────────────────────────────────

/**
 * Render the floor plan for `floorId` to an offscreen HTMLCanvasElement and
 * return it.  Returns null (and logs a warning) if there is nothing to draw.
 *
 * @param {{
 *   rooms:   Record<string, Object>,  // all rooms (the entire map)
 *   objects?: Record<string, Object>, // placed objects (the entire map)
 *   floors:  Record<string|number, Object>,
 *   floorId: string|number,
 *   floorName?: string,
 * }} params
 * @returns {HTMLCanvasElement|null}
 */
export function renderFloorPlanToCanvas({ rooms, objects = {}, floors, floorId, floorName }) {
  const floorRooms = Object.values(rooms).filter((r) => r.floor === floorId);
  const floorObjects = Object.values(objects).filter((object) => (object.floor ?? 0) === floorId);
  if (!floorRooms.length && !floorObjects.length) return null;

  const bounds = floorBounds(floorRooms, floorObjects);
  if (!bounds) return null;

  // Canvas size — cap to MAX_CANVAS_DIM to avoid GPU/browser limits on huge plans
  const planWRaw = Math.max(bounds.w, 1) * PIXELS_PER_METER;
  const planHRaw = Math.max(bounds.h, 1) * PIXELS_PER_METER;
  const titleH   = 36 * (PIXELS_PER_METER / BASE_SCALE);
  const rawW = planWRaw + MARGIN_PX * 2;
  const rawH = planHRaw + MARGIN_PX * 2 + titleH;

  // If either dimension exceeds the cap, scale the whole canvas down uniformly
  const capScale = Math.min(1, MAX_CANVAS_DIM / Math.max(rawW, rawH));
  const pxPerM   = PIXELS_PER_METER * capScale;
  const detailScale = pxPerM / BASE_SCALE;
  const margin   = MARGIN_PX * capScale;

  const planW = Math.max(bounds.w, 1) * pxPerM;
  const planH = Math.max(bounds.h, 1) * pxPerM;
  const scaledTitleH = 36 * detailScale;
  const canvasW = Math.ceil(planW + margin * 2);
  const canvasH = Math.ceil(planH + margin * 2 + scaledTitleH);

  const canvas  = document.createElement('canvas');
  canvas.width  = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Transform origin: top-left of the plan content area
  // In world coords the plan starts at (bounds.minX, bounds.maxZ) → canvas (margin, margin + titleH)
  const tx = margin - bounds.minX * pxPerM;
  const ty = margin + scaledTitleH + bounds.maxZ * pxPerM;

  // ── Draw room fills ───────────────────────────────────────────────────
  for (const room of floorRooms) {
    const color  = room.color ?? typeColor(room);
    const fill   = roomFill(color);
    const tl = toCanvas(room.x - room.width / 2, room.z + room.depth / 2, tx, ty, pxPerM);
    const wPx = room.width * pxPerM;
    const hPx = room.depth * pxPerM;

    ctx.fillStyle = fill;
    ctx.fillRect(tl.cx, tl.cy, wPx, hPx);
  }

  // ── Draw placed object footprints ─────────────────────────────────────
  for (const object of floorObjects) {
    const asset = ASSET_TYPES[object.assetType];
    if (!asset) continue;

    const width = asset.defaultWidth * Math.abs(object.scaleX ?? 1) * pxPerM;
    const depth = asset.defaultDepth * Math.abs(object.scaleZ ?? 1) * pxPerM;
    const center = toCanvas(object.x, object.z, tx, ty, pxPerM);
    const rotation = object.rotationY ?? 0;
    const color = asset.color ?? '#8899aa';

    ctx.save();
    ctx.translate(center.cx, center.cy);
    ctx.rotate(rotation);
    ctx.fillStyle = roomFill(color);
    ctx.strokeStyle = WALL_COLOR;
    ctx.lineWidth = 1.5 * detailScale;
    if (['COLUMN', 'PLANT_LARGE', 'PLANT_SMALL', 'SPAWN_POINT'].includes(object.assetType)) {
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(width, depth) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(-width / 2, -depth / 2, width, depth);
      ctx.strokeRect(-width / 2, -depth / 2, width, depth);
      if (object.assetType === 'STAIRCASE') {
        const stepCount = Math.max(2, Math.floor(depth / (0.2 * pxPerM)));
        ctx.beginPath();
        for (let i = 1; i < stepCount; i++) {
          const y = -depth / 2 + (depth * i) / stepCount;
          ctx.moveTo(-width / 2, y);
          ctx.lineTo(width / 2, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── Draw walls (outlines) ─────────────────────────────────────────────
  ctx.strokeStyle = WALL_COLOR;
  ctx.lineWidth   = WALL_STROKE * detailScale;
  ctx.lineJoin    = 'miter';
  for (const room of floorRooms) {
    const tl = toCanvas(room.x - room.width / 2, room.z + room.depth / 2, tx, ty, pxPerM);
    const wPx = room.width * pxPerM;
    const hPx = room.depth * pxPerM;
    ctx.strokeRect(tl.cx, tl.cy, wPx, hPx);
  }

  // ── Draw openings (doors then windows) ────────────────────────────────
  for (const room of floorRooms) {
    const openings = roomOpenings(room);
    for (const op of openings) {
      if (op.kind === 'window') drawWindow(ctx, op, room, tx, ty, pxPerM, detailScale);
    }
    for (const op of openings) {
      if (op.kind === 'door') drawDoor(ctx, op, room, tx, ty, pxPerM, detailScale);
    }
  }

  // ── Room labels and dimensions ────────────────────────────────────────
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  for (const room of floorRooms) {
    const { cx: rcx, cy: rcy } = toCanvas(room.x, room.z, tx, ty, pxPerM);
    const wPx = room.width  * pxPerM;
    const hPx = room.depth  * pxPerM;

    // Room name
    if (room.name) {
      ctx.font      = `600 ${LABEL_FONT_SIZE * detailScale}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#1a1a2e';
      // Clip long names to the room width
      const maxW = wPx - 12 * detailScale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rcx - wPx / 2, rcy - hPx / 2, wPx, hPx);
      ctx.clip();
      ctx.fillText(room.name, rcx, rcy - 8 * detailScale, maxW);
      ctx.restore();
    }

    // Dimensions below the name
    const dimText = `${room.width.toFixed(1)} × ${room.depth.toFixed(1)} m`;
    ctx.font      = `${DIM_FONT_SIZE * detailScale}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#555577';
    ctx.save();
    ctx.beginPath();
    ctx.rect(rcx - wPx / 2, rcy - hPx / 2, wPx, hPx);
    ctx.clip();
    ctx.fillText(dimText, rcx, rcy + 8 * detailScale, wPx - 8 * detailScale);
    ctx.restore();

    // Width dimension arrow (top edge)
    if (wPx > 60) {
      const tl = toCanvas(room.x - room.width / 2, room.z + room.depth / 2, tx, ty, pxPerM);
      const tr = toCanvas(room.x + room.width / 2, room.z + room.depth / 2, tx, ty, pxPerM);
      drawDimension(ctx, tl.cx, tl.cy, tr.cx, tr.cy, `${room.width.toFixed(1)} m`, -1, detailScale);
    }

    // Depth dimension arrow (right edge)
    if (hPx > 60) {
      const tr  = toCanvas(room.x + room.width / 2, room.z + room.depth / 2, tx, ty, pxPerM);
      const br  = toCanvas(room.x + room.width / 2, room.z - room.depth / 2, tx, ty, pxPerM);
      drawDimension(ctx, tr.cx, tr.cy, br.cx, br.cy, `${room.depth.toFixed(1)} m`, 1, detailScale);
    }
  }

  // ── Floor title at the top ────────────────────────────────────────────
  ctx.font      = `600 ${TITLE_FONT_SIZE * detailScale}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = '#1a1a2e';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const title = floorName || `Floor ${floorId}`;
  ctx.fillText(title, margin, margin / 2);

  // Subtitle: room count + area
  const totalArea = floorRooms.reduce((s, r) => s + r.width * r.depth, 0);
  const subtitle  = `${floorRooms.length} room${floorRooms.length === 1 ? '' : 's'} · ${Math.round(totalArea)} m²`;
  ctx.font      = `${DIM_FONT_SIZE * detailScale}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = '#555577';
  ctx.fillText(subtitle, margin, margin / 2 + (TITLE_FONT_SIZE + 3) * detailScale);

  return canvas;
}

// ── PNG export ────────────────────────────────────────────────────────────

/**
 * Export a floor's plan as a PNG file download.
 *
 * @param {Object} params
 * @param {Record<string, Object>} params.rooms
 * @param {Record<string, Object>} [params.objects]
 * @param {Record<string|number, Object>} params.floors
 * @param {string|number} params.floorId
 * @param {string} [params.floorName]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export async function exportFloorPlanAsPng({ rooms, objects, floors, floorId, floorName }) {
  try {
    const canvas = renderFloorPlanToCanvas({ rooms, objects, floors, floorId, floorName });
    if (!canvas) {
      return { ok: false, error: 'No rooms found on this floor.' };
    }

    return await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve({ ok: false, error: 'Canvas export failed.' }); return; }
        const safeName = (floorName || `floor-${floorId}`)
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-')
          .toLowerCase();
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href     = url;
        link.download = `floor-plan-${safeName}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        resolve({ ok: true });
      }, 'image/png');
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? 'Unknown error during PNG export.' };
  }
}

// ── PDF export ────────────────────────────────────────────────────────────

/**
 * Export a floor's plan as a PDF file download using jsPDF.
 *
 * @param {Object} params
 * @param {Record<string, Object>} params.rooms
 * @param {Record<string, Object>} [params.objects]
 * @param {Record<string|number, Object>} params.floors
 * @param {string|number} params.floorId
 * @param {string} [params.floorName]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export async function exportFloorPlanAsPdf({ rooms, objects, floors, floorId, floorName }) {
  try {
    const canvas = renderFloorPlanToCanvas({ rooms, objects, floors, floorId, floorName });
    if (!canvas) {
      return { ok: false, error: 'No rooms found on this floor.' };
    }

    // Lazy-import jsPDF to keep the main bundle lighter
    const { jsPDF } = await import('jspdf');

    const imgData   = canvas.toDataURL('image/png');
    const imgW      = canvas.width;   // px (at PIXELS_PER_METER resolution)
    const imgH      = canvas.height;

    // A4 page dimensions in mm (297 × 210 landscape, 210 × 297 portrait)
    const pageMargin = 15;  // mm
    const maxW = 297 - pageMargin * 2;  // landscape
    const maxH = 210 - pageMargin * 2;

    // Choose orientation based on the plan's aspect ratio
    const landscape = imgW >= imgH;
    const availW = landscape ? maxW : (210 - pageMargin * 2);
    const availH = landscape ? maxH : (297 - pageMargin * 2);

    // Scale to fit the available area uniformly
    const scale = Math.min(availW / imgW, availH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;

    const orientation = landscape ? 'landscape' : 'portrait';
    const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });

    // Centre on the page
    const pageW = landscape ? 297 : 210;
    const pageH = landscape ? 210 : 297;
    const offsetX = (pageW - drawW) / 2;
    const offsetY = (pageH - drawH) / 2;

    doc.addImage(imgData, 'PNG', offsetX, offsetY, drawW, drawH);

    const safeName = (floorName || `floor-${floorId}`)
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
    doc.save(`floor-plan-${safeName}.pdf`);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? 'Unknown error during PDF export.' };
  }
}
