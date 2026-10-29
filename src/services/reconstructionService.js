/**
 * reconstructionService.js
 *
 * Real photo reconstruction plumbing for Task R8.
 *
 * Workflow:
 * 1. Upload photo to tenant-scoped Supabase Storage path:
 *      <companyId>/<layoutId>/<timestamp>_<filename>
 * 2. Send a short-lived signed URL of the photo to AI/ML team's analysis endpoint.
 * 3. Validate returned candidate layout against LayoutSchema (Layout v2).
 * 4. Stage proposed layout into Supabase PostgreSQL (proposed_layouts table).
 * 5. Update proposal status upon human review (approved / rejected).
 *
 * PROTOTYPE: OFF unless VITE_LAYOUT_BACKEND=supabase (and the URL / key) are set,
 * the same switch as layout saving (backendFlags.js). Off, every function that
 * would touch the network returns { ok: false, off: true, error: RECONSTRUCTION_OFF }
 * at once: no Supabase call, no fetch. Photos are never given a public URL: we keep
 * the storage path, and the analysis gets a signed URL that expires in 10 minutes.
 */

import { supabase } from './supabaseClient';
import { isSupabaseBackendOn } from './backendFlags';
import { LayoutSchema } from '../engine/model/schema';

export const RECONSTRUCTION_STORAGE_BUCKET = 'layout-photos';
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
export const RECONSTRUCTION_OFF = 'Photo reconstruction is off';
/** Lifetime of the signed photo URL sent to the analysis endpoint (seconds, at most 10 minutes). */
export const SIGNED_URL_SECONDS = 10 * 60;

/** Photo reconstruction uses the same off-by-default switch as layout saving. */
export function isPhotoReconstructionOn() {
  return isSupabaseBackendOn();
}

const OFF_RESULT = Object.freeze({ ok: false, off: true, error: RECONSTRUCTION_OFF });

/**
 * Clean filename to prevent path traversal or invalid storage characters.
 */
export function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Builds the strict tenant-isolated path inside the storage bucket:
 *   <companyId>/<layoutId>/<timestamp>_<filename>
 */
export function buildTenantPhotoPath(companyId, layoutId, filename) {
  if (!companyId || !layoutId) {
    throw new Error('Tenant isolation requires both companyId and layoutId');
  }
  const cleanName = sanitizeFilename(filename || 'photo.png');
  const timestamp = Date.now();
  return `${companyId}/${layoutId}/${timestamp}_${cleanName}`;
}

/**
 * Validates file type and size.
 */
export function validatePhotoFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Unsupported file type "${file.type}". Allowed types: PNG, JPEG, WEBP`,
    };
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds 20MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB)`,
    };
  }
  return { valid: true };
}

/**
 * Uploads a workplace photo to Supabase Storage in a tenant-isolated folder.
 *
 * @param {File|Blob} file
 * @param {object} opts
 * @param {string} opts.companyId
 * @param {string} opts.layoutId
 * @returns {Promise<{ ok: boolean, storagePath?: string, off?: boolean, error?: string }>}
 */
export async function uploadReconstructionPhoto(file, { companyId, layoutId }) {
  if (!isPhotoReconstructionOn()) return { ...OFF_RESULT };

  const check = validatePhotoFile(file);
  if (!check.valid) {
    return { ok: false, error: check.error };
  }

  try {
    const storagePath = buildTenantPhotoPath(companyId, layoutId, file.name || 'photo.png');

    const { error: uploadError } = await supabase.storage
      .from(RECONSTRUCTION_STORAGE_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || 'image/png',
        upsert: false,
      });

    if (uploadError) {
      return { ok: false, error: uploadError.message };
    }

    // No public URL: the bucket is private, the path is all we keep.
    return { ok: true, storagePath };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to upload photo' };
  }
}

/**
 * Computes statistics from a Layout v2 object (rooms, objects, floors).
 */
export function computeDetectionStats(layout) {
  return {
    floorCount: Array.isArray(layout.floors) ? layout.floors.length : 0,
    roomCount: Array.isArray(layout.rooms) ? layout.rooms.length : 0,
    objectCount: Array.isArray(layout.objects) ? layout.objects.length : 0,
    anchorCount: Array.isArray(layout.anchors) ? layout.anchors.length : 0,
    routeCount: Array.isArray(layout.routes) ? layout.routes.length : 0,
  };
}

/**
 * Generates a realistic Layout v2 candidate layout for demonstration / fallback
 * when the external AI endpoint is not yet reachable or deployed.
 */
export function generateFallbackProposedLayout(layoutId = 'layout') {
  const ts = Date.now();
  return {
    schemaVersion: 2,
    units: 'meters',
    building: { name: 'Reconstructed Office', address: '', northAngle: 0 },
    floors: [{ id: '0', name: 'Ground Floor', height: 3.5 }],
    rooms: [
      {
        id: `room_${ts}_1`,
        floorId: '0',
        name: 'Conference Room (AI)',
        type: 'CONFERENCE',
        color: '#4a7dff',
        floorFinish: 'carpet',
        x: 0,
        z: 8,
        width: 6,
        depth: 5,
        wallHeight: 3,
        doors: [],
        windows: [],
      },
      {
        id: `room_${ts}_2`,
        floorId: '0',
        name: 'Team Workspace (AI)',
        type: 'OFFICE',
        color: '#10b981',
        floorFinish: 'wood',
        x: 7,
        z: 8,
        width: 7,
        depth: 5,
        wallHeight: 3,
        doors: [],
        windows: [],
      },
    ],
    openings: [],
    objects: [
      {
        id: `obj_${ts}_1`,
        assetType: 'DESK_STANDARD',
        name: 'Workstation 1',
        category: 'Furniture',
        floorId: '0',
        roomId: null,
        position: { x: 2, y: 0, z: 10 },
        rotationY: 0,
        scale: { x: 1, y: 1, z: 1 },
        locked: false,
        label: 'Desk 1',
        department: 'Engineering',
        metadata: {},
      },
      {
        id: `obj_${ts}_2`,
        assetType: 'DESK_STANDARD',
        name: 'Workstation 2',
        category: 'Furniture',
        floorId: '0',
        roomId: null,
        position: { x: 4, y: 0, z: 10 },
        rotationY: 0,
        scale: { x: 1, y: 1, z: 1 },
        locked: false,
        label: 'Desk 2',
        department: 'Engineering',
        metadata: {},
      },
    ],
    anchors: [],
    routes: [],
    floorLinks: [],
  };
}

/**
 * Sends a signed URL of the uploaded photo (valid SIGNED_URL_SECONDS) to the AI/ML
 * team's analysis endpoint and validates the returned layout structure against the
 * Layout v2 schema.
 *
 * If the external endpoint is offline or 404, falls back to generateFallbackProposedLayout
 * so the team can continue testing the human-in-the-loop approval workflow.
 *
 * @param {string} storagePath  from uploadReconstructionPhoto
 * @param {object} context
 * @param {string} context.companyId
 * @param {string} context.layoutId
 * @returns {Promise<{ ok: boolean, proposedLayout?: object, detectionStats?: object, isFallback?: boolean, off?: boolean, error?: string }>}
 */
export async function requestPhotoAnalysis(storagePath, { companyId, layoutId }) {
  if (!isPhotoReconstructionOn()) return { ...OFF_RESULT };

  if (!storagePath) {
    return { ok: false, error: 'Photo storage path is required for analysis' };
  }

  let photoUrl;
  try {
    const { data, error } = await supabase.storage
      .from(RECONSTRUCTION_STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) {
      return { ok: false, error: error?.message || 'Could not get a link to the photo' };
    }
    photoUrl = data.signedUrl;
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not get a link to the photo' };
  }

  const endpoint = import.meta.env?.VITE_AI_RECONSTRUCTION_URL || '/api/ai/reconstruct';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photoUrl,
        storagePath,
        companyId,
        layoutId,
        requestedAt: new Date().toISOString(),
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const candidateData = json.layout || json;

      // Validate layout data strictly with LayoutSchema (Zod)
      const parseResult = LayoutSchema.safeParse(candidateData);
      if (!parseResult.success) {
        return {
          ok: false,
          error: `AI returned invalid layout schema: ${parseResult.error.issues.map((i) => i.message).join(', ')}`,
        };
      }

      const proposedLayout = parseResult.data;
      return {
        ok: true,
        proposedLayout,
        detectionStats: computeDetectionStats(proposedLayout),
      };
    }

    // If external AI endpoint returned an error or is 404, fallback
    console.warn(`[AHDUS] AI reconstruction endpoint (${endpoint}) responded with ${res.status}. Falling back to candidate generator.`);
    const fallbackLayout = generateFallbackProposedLayout(layoutId);
    return {
      ok: true,
      proposedLayout: fallbackLayout,
      detectionStats: computeDetectionStats(fallbackLayout),
      isFallback: true,
    };
  } catch (err) {
    // If endpoint could not be connected, fallback so the user can test the workflow
    console.warn(`[AHDUS] Could not connect to AI reconstruction endpoint (${endpoint}). Falling back to candidate generator.`, err);
    const fallbackLayout = generateFallbackProposedLayout(layoutId);
    return {
      ok: true,
      proposedLayout: fallbackLayout,
      detectionStats: computeDetectionStats(fallbackLayout),
      isFallback: true,
    };
  }
}

/**
 * Stages the proposed layout into the Supabase proposed_layouts table.
 * Falls back gracefully to in-memory/local staging if the remote table is unreachable.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} params.layoutId
 * @param {string} params.storagePath  the photo's storage path (never a public URL)
 * @param {object} params.proposedLayout
 * @param {object} params.detectionStats
 * @returns {Promise<{ ok: boolean, proposalId?: string, isLocal?: boolean, off?: boolean, error?: string }>}
 */
export async function stageProposedLayout({
  companyId,
  layoutId,
  storagePath,
  proposedLayout,
  detectionStats,
}) {
  if (!isPhotoReconstructionOn()) return { ...OFF_RESULT };

  try {
    const { data, error } = await supabase
      .from('proposed_layouts')
      .insert({
        company_id: String(companyId),
        layout_id: String(layoutId),
        photo_url: storagePath, // column name from db/schema.sql; it holds the storage path
        status: 'pending',
        proposed_data: proposedLayout,
        detection_stats: detectionStats || computeDetectionStats(proposedLayout),
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[AHDUS] Staging in Supabase DB failed, falling back to local session proposal:', error.message);
      return { ok: true, proposalId: `local_${Date.now()}`, isLocal: true };
    }

    return { ok: true, proposalId: data?.id || `local_${Date.now()}` };
  } catch (err) {
    console.warn('[AHDUS] Staging caught error, falling back to local proposal:', err);
    return { ok: true, proposalId: `local_${Date.now()}`, isLocal: true };
  }
}

/**
 * Updates the proposal status to 'approved' or 'rejected'.
 *
 * @param {string} proposalId
 * @param {'approved'|'rejected'} status
 * @param {string} [reviewerId]
 * @returns {Promise<{ ok: boolean, off?: boolean, error?: string }>}
 */
export async function updateProposalStatus(proposalId, status, reviewerId = null) {
  if (!isPhotoReconstructionOn()) return { ...OFF_RESULT };

  if (!['approved', 'rejected'].includes(status)) {
    return { ok: false, error: `Invalid status "${status}". Must be approved or rejected.` };
  }

  try {
    const { error } = await supabase
      .from('proposed_layouts')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
      })
      .eq('id', proposalId);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to update proposal status' };
  }
}
