import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeAiLayout,
  handleReconstructionRequest,
  VALID_ROOM_TYPES,
  VALID_ASSET_TYPES,
} from '../aiReconstructionHandler';
import { LayoutSchema } from '../../engine/model/schema';

describe('aiReconstructionHandler', () => {
  describe('normalizeAiLayout', () => {
    it('produces a valid Layout v2 structure with schemaVersion 2', () => {
      const raw = {
        building: { name: 'Main Office' },
        rooms: [
          { name: 'Room 1', type: 'OFFICE', x: 0, z: 0, width: 4, depth: 5 },
        ],
        objects: [
          { assetType: 'DESK_STANDARD', x: 0, z: 0 },
        ],
      };

      const normalized = normalizeAiLayout(raw);
      expect(normalized.schemaVersion).toBe(2);
      expect(normalized.units).toBe('meters');
      expect(normalized.rooms.length).toBe(1);
      expect(normalized.objects.length).toBe(1);

      const parsed = LayoutSchema.safeParse(normalized);
      expect(parsed.success).toBe(true);
    });

    it('sanitizes invalid or unknown room types to OFFICE', () => {
      const raw = {
        rooms: [
          { name: 'Space', type: 'INVALID_TYPE', x: 0, z: 0, width: 3, depth: 3 },
        ],
      };
      const normalized = normalizeAiLayout(raw);
      expect(normalized.rooms[0].type).toBe('OFFICE');
    });

    it('preserves all valid room types from RoomTypeSchema', () => {
      for (const type of VALID_ROOM_TYPES) {
        const normalized = normalizeAiLayout({
          rooms: [{ name: 'Test', type, x: 0, z: 0, width: 4, depth: 4 }],
        });
        expect(normalized.rooms[0].type).toBe(type);
      }
    });

    it('sanitizes unknown asset types to DESK_STANDARD', () => {
      const raw = {
        objects: [
          { assetType: 'SUPER_ROBOT_9000', x: 0, z: 0 },
        ],
      };
      const normalized = normalizeAiLayout(raw);
      expect(normalized.objects[0].assetType).toBe('DESK_STANDARD');
    });

    it('preserves valid asset types from catalog', () => {
      for (const assetType of VALID_ASSET_TYPES) {
        const normalized = normalizeAiLayout({
          objects: [{ assetType, x: 0, z: 0 }],
        });
        expect(normalized.objects[0].assetType).toBe(assetType);
      }
    });

    it('enforces minimum room dimensions (>= 1.5m)', () => {
      const raw = {
        rooms: [
          { name: 'Tiny', type: 'OFFICE', x: 0, z: 0, width: 0.2, depth: 0.1 },
        ],
      };
      const normalized = normalizeAiLayout(raw);
      expect(normalized.rooms[0].width).toBeGreaterThanOrEqual(1.5);
      expect(normalized.rooms[0].depth).toBeGreaterThanOrEqual(1.5);
    });

    it('associates objects with parent room when within room bounds', () => {
      const raw = {
        rooms: [
          { id: 'conf_1', name: 'Conference', type: 'MEETING', x: 10, z: 10, width: 6, depth: 6 },
        ],
        objects: [
          { assetType: 'MEETING_TABLE', x: 10, z: 10 },
          { assetType: 'DESK_STANDARD', x: 100, z: 100 }, // Outside room
        ],
      };
      const normalized = normalizeAiLayout(raw);
      expect(normalized.objects[0].roomId).toBe('conf_1');
      expect(normalized.objects[1].roomId).toBeNull();
    });
  });

  describe('handleReconstructionRequest', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('fails when no API key is provided', async () => {
      const res = await handleReconstructionRequest({ base64Image: 'abcd' }, '');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('No AI Vision API key configured');
    });

    it('successfully calls Groq Vision API when GROQ_API_KEY is provided', async () => {
      const groqResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                building: { name: 'Groq Office' },
                rooms: [
                  { name: 'Open Office', type: 'OFFICE', x: 0, z: 0, width: 8, depth: 6 },
                ],
                objects: [
                  { assetType: 'DESK_STANDARD', x: 0, z: 0 },
                ],
              }),
            },
          },
        ],
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => groqResponse,
      }));

      const res = await handleReconstructionRequest(
        { base64Image: 'data:image/jpeg;base64,1234' },
        'gsk_test_key_12345'
      );

      expect(res.ok).toBe(true);
      expect(res.modelUsed).toContain('groq');
      expect(res.layout.rooms[0].name).toBe('Open Office');
    });

    it('fails when neither photoUrl nor base64Image is provided', async () => {
      const res = await handleReconstructionRequest({}, 'fake-key');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('No image data provided');
    });

    it('successfully calls Gemini Vision API and returns validated layout', async () => {
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    building: { name: 'AI Reconstructed Office' },
                    rooms: [
                      { name: 'Boardroom', type: 'MEETING', x: 0, z: 0, width: 6, depth: 5 },
                      { name: 'Developer Hub', type: 'OFFICE', x: 8, z: 0, width: 8, depth: 6 },
                    ],
                    objects: [
                      { assetType: 'MEETING_TABLE', x: 0, z: 0, rotationY: 0 },
                      { assetType: 'DESK_STANDARD', x: 8, z: 0, rotationY: 0 },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => geminiResponse,
      }));

      const res = await handleReconstructionRequest(
        {
          base64Image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
        },
        'test-api-key'
      );

      expect(res.ok).toBe(true);
      expect(res.layout.schemaVersion).toBe(2);
      expect(res.layout.rooms.length).toBe(2);
      expect(res.layout.objects.length).toBe(2);
      expect(res.detectionStats.roomCount).toBe(2);
      expect(res.detectionStats.objectCount).toBe(2);
      expect(res.modelUsed).toBe('gemini-3.8-flash');
    });

    it('falls back to gemini-3.5-flash-lite if gemini-3.8-flash fails', async () => {
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    rooms: [{ name: 'Office', type: 'OFFICE', x: 0, z: 0, width: 4, depth: 4 }],
                    objects: [],
                  }),
                },
              ],
            },
          },
        ],
      };

      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
        callCount++;
        if (callCount === 1) {
          // 3.8-flash fails
          return Promise.resolve({
            ok: false,
            status: 503,
            json: async () => ({ error: { message: 'Overloaded' } }),
          });
        }
        // 3.5-flash-lite succeeds
        return Promise.resolve({
          ok: true,
          json: async () => geminiResponse,
        });
      }));

      const res = await handleReconstructionRequest(
        {
          base64Image: 'base64bytes',
          mimeType: 'image/png',
        },
        'test-api-key'
      );

      expect(res.ok).toBe(true);
      expect(res.modelUsed).toBe('gemini-3.5-flash-lite');
      expect(res.layout.rooms.length).toBe(1);
    });

    it('uses only Groq and never Gemini when only groqApiKey is passed in apiConfig', async () => {
      const origGemini = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'stale-system-key';

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  building: { name: 'Groq Only Office' },
                  rooms: [{ name: 'Executive Suite', type: 'OFFICE', x: 0, z: 0, width: 5, depth: 5 }],
                  objects: [],
                }),
              },
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await handleReconstructionRequest(
        { base64Image: 'data:image/png;base64,123' },
        { groqApiKey: 'gsk_test_only_groq', geminiApiKey: '' }
      );

      expect(res.ok).toBe(true);
      expect(res.modelUsed).toContain('groq');
      for (const call of fetchMock.mock.calls) {
        expect(call[0]).not.toContain('googleapis.com');
      }

      process.env.GEMINI_API_KEY = origGemini;
    });
  });
});

