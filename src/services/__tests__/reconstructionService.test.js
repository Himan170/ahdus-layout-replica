import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validatePhotoFile,
  sanitizeFilename,
  buildTenantPhotoPath,
  computeDetectionStats,
  requestPhotoAnalysis,
  uploadReconstructionPhoto,
  stageProposedLayout,
  updateProposalStatus,
  RECONSTRUCTION_STORAGE_BUCKET,
  SIGNED_URL_SECONDS,
} from '../reconstructionService';
import * as clientModule from '../supabaseClient';

const SIGNED_URL = 'https://supabase.co/storage/v1/object/sign/layout-photos/c1/l1/123_photo.png?token=t';

/** Turn photo reconstruction on (the flag + a configured client) with this mock client. */
function turnOn(client) {
  vi.stubEnv('VITE_LAYOUT_BACKEND', 'supabase');
  vi.spyOn(clientModule, 'supabase', 'get').mockReturnValue(client);
  vi.spyOn(clientModule, 'isSupabaseConfigured', 'get').mockReturnValue(true);
}

/** A client whose storage gives signed URLs. */
function signingClient(createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: SIGNED_URL }, error: null })) {
  return { storage: { from: vi.fn(() => ({ createSignedUrl })) } };
}

describe('reconstructionService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('File validation and path building', () => {
    it('validates supported image types (png, jpeg, webp)', () => {
      expect(validatePhotoFile({ type: 'image/png', size: 1024 }).valid).toBe(true);
      expect(validatePhotoFile({ type: 'image/jpeg', size: 1024 }).valid).toBe(true);
      expect(validatePhotoFile({ type: 'image/webp', size: 1024 }).valid).toBe(true);
    });

    it('rejects unsupported file types (pdf, txt, exe)', () => {
      const res = validatePhotoFile({ type: 'application/pdf', size: 1024 });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('Unsupported file type');
    });

    it('rejects files larger than 20MB', () => {
      const oversized = 21 * 1024 * 1024;
      const res = validatePhotoFile({ type: 'image/png', size: oversized });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('exceeds 20MB limit');
    });

    it('sanitizes filename to remove path traversal and spaces', () => {
      expect(sanitizeFilename('../../evil photo.png')).toBe('.._.._evil_photo.png');
      expect(sanitizeFilename('normal-photo_1.jpg')).toBe('normal-photo_1.jpg');
    });

    it('builds tenant-isolated storage path', () => {
      const path = buildTenantPhotoPath('comp_123', 'lay_456', 'floor plan.png');
      expect(path.startsWith('comp_123/lay_456/')).toBe(true);
      expect(path.endsWith('_floor_plan.png')).toBe(true);
    });

    it('throws if tenant companyId or layoutId is missing', () => {
      expect(() => buildTenantPhotoPath(null, 'lay_456', 'photo.png')).toThrow();
      expect(() => buildTenantPhotoPath('comp_123', null, 'photo.png')).toThrow();
    });
  });

  describe('computeDetectionStats', () => {
    it('correctly calculates statistics from layout v2', () => {
      const stats = computeDetectionStats({
        floors: [{ id: 'f0' }, { id: 'f1' }],
        rooms: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
        objects: [{ id: 'o1' }],
        anchors: [{ id: 'a1' }, { id: 'a2' }],
        routes: [],
      });
      expect(stats.floorCount).toBe(2);
      expect(stats.roomCount).toBe(3);
      expect(stats.objectCount).toBe(1);
      expect(stats.anchorCount).toBe(2);
      expect(stats.routeCount).toBe(0);
    });
  });

  describe('requestPhotoAnalysis with Zod validation', () => {
    beforeEach(() => {
      turnOn(signingClient());
    });

    it('validates and accepts valid Layout v2 output from AI service', async () => {
      const validLayout = {
        schemaVersion: 2,
        units: 'meters',
        building: { name: 'HQ', address: 'Tech Park', northAngle: 0 },
        floors: [{ id: '0', name: 'Ground', height: 3.5 }],
        rooms: [
          {
            id: 'room_1',
            floorId: '0',
            name: 'Office A',
            type: 'OFFICE',
            color: '#4a7dff',
            boundary: [
              { x: 0, y: 0, z: 0 },
              { x: 5, y: 0, z: 0 },
              { x: 5, y: 0, z: 4 },
              { x: 0, y: 0, z: 4 },
            ],
          },
        ],
        openings: [],
        objects: [],
        anchors: [],
        routes: [],
        floorLinks: [],
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ layout: validLayout }),
      }));

      const res = await requestPhotoAnalysis('c1/l1/123_photo.png', {
        companyId: 'c1',
        layoutId: 'l1',
      });

      expect(res.ok).toBe(true);
      expect(res.proposedLayout.schemaVersion).toBe(2);
      expect(res.detectionStats.roomCount).toBe(1);
    });

    it('rejects invalid layout output missing required schema fields', async () => {
      const invalidLayout = {
        schemaVersion: 1, // Invalid: requires schemaVersion: 2
        rooms: 'not-an-array',
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ layout: invalidLayout }),
      }));

      const res = await requestPhotoAnalysis('c1/l1/123_photo.png', {
        companyId: 'c1',
        layoutId: 'l1',
      });

      expect(res.ok).toBe(false);
      expect(res.error).toContain('AI returned invalid layout schema');
    });

    it('sends a signed URL that expires within 10 minutes, never a public one', async () => {
      const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: SIGNED_URL }, error: null });
      const getPublicUrl = vi.fn();
      const client = { storage: { from: vi.fn(() => ({ createSignedUrl, getPublicUrl })) } };
      turnOn(client);
      const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      vi.stubGlobal('fetch', fetchSpy);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const res = await requestPhotoAnalysis('c1/l1/123_photo.png', { companyId: 'c1', layoutId: 'l1' });

      expect(res.ok).toBe(true);
      expect(client.storage.from).toHaveBeenCalledWith(RECONSTRUCTION_STORAGE_BUCKET);
      expect(createSignedUrl).toHaveBeenCalledWith('c1/l1/123_photo.png', SIGNED_URL_SECONDS);
      expect(SIGNED_URL_SECONDS).toBeLessThanOrEqual(600);
      expect(getPublicUrl).not.toHaveBeenCalled();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.photoUrl).toBe(SIGNED_URL);
      expect(body.storagePath).toBe('c1/l1/123_photo.png');
    });

    it('stops (no fetch) when no signed URL can be made', async () => {
      turnOn(signingClient(vi.fn().mockResolvedValue({ data: null, error: { message: 'Object not found' } })));
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const res = await requestPhotoAnalysis('c1/l1/missing.png', { companyId: 'c1', layoutId: 'l1' });

      expect(res).toEqual({ ok: false, error: 'Object not found' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Supabase storage and database integration', () => {
    it('uploads photo to tenant-isolated Supabase storage bucket and returns its path, no public URL', async () => {
      const mockUpload = vi.fn().mockResolvedValue({ data: { path: 'c1/l1/123_test.png' }, error: null });
      const mockGetPublicUrl = vi.fn();

      const mockClient = {
        storage: {
          from: vi.fn((bucket) => {
            expect(bucket).toBe(RECONSTRUCTION_STORAGE_BUCKET);
            return {
              upload: mockUpload,
              getPublicUrl: mockGetPublicUrl,
            };
          }),
        },
      };

      turnOn(mockClient);

      const fakeFile = new File(['image-bytes'], 'test.png', { type: 'image/png' });
      const res = await uploadReconstructionPhoto(fakeFile, { companyId: 'c1', layoutId: 'l1' });

      expect(res.ok).toBe(true);
      expect(res.storagePath).toMatch(/^c1\/l1\/\d+_test\.png$/);
      expect(res).not.toHaveProperty('photoUrl');
      expect(mockUpload).toHaveBeenCalledWith(res.storagePath, fakeFile, expect.objectContaining({ upsert: false }));
      expect(mockGetPublicUrl).not.toHaveBeenCalled();
    });

    it('stages proposed layout into proposed_layouts table', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'prop_999' }, error: null }),
        }),
      });

      const mockClient = {
        from: vi.fn((table) => {
          expect(table).toBe('proposed_layouts');
          return { insert: mockInsert };
        }),
      };

      turnOn(mockClient);

      const res = await stageProposedLayout({
        companyId: 'c1',
        layoutId: 'l1',
        storagePath: 'c1/l1/123_photo.png',
        proposedLayout: { schemaVersion: 2, rooms: [], objects: [] },
      });

      expect(res.ok).toBe(true);
      expect(res.proposalId).toBe('prop_999');
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ photo_url: 'c1/l1/123_photo.png' }));
    });

    it('updates proposal status on approval or rejection', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockClient = {
        from: vi.fn(() => ({ update: mockUpdate })),
      };

      turnOn(mockClient);

      const res = await updateProposalStatus('prop_999', 'approved', 'user_123');
      expect(res.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
          reviewed_by: 'user_123',
        })
      );
    });
  });
});
