/**
 * server/__tests__/aiReconstructionHandler.test.js
 *
 * Tests for server-side AI floor plan reconstruction:
 * - Size limit enforcement (<= 10MB)
 * - MIME type validation (PNG, JPEG, WebP only)
 * - Coordinate system: room (x, z) represents geometric room center
 * - API key security: Gemini key sent only in headers, never in URL
 * - Error handling: AI failures return ok: false with informative error
 * - Multi-provider dispatch: Groq (Qwen 3.8 27B), OpenRouter, Gemini
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleReconstructionRequest,
  normalizeAiLayout,
  parseJsonFromResponse,
  VALID_ROOM_TYPES,
  VALID_ASSET_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
} from '../aiReconstructionHandler';

describe('aiReconstructionHandler (server)', () => {
  describe('validation constants and helpers', () => {
    it('has standard CAD room and asset types', () => {
      expect(VALID_ROOM_TYPES).toContain('OFFICE');
      expect(VALID_ROOM_TYPES).toContain('MEETING');
      expect(VALID_ROOM_TYPES).toContain('RECEPTION');
      expect(VALID_ASSET_TYPES).toContain('DESK_STANDARD');
      expect(VALID_ASSET_TYPES).toContain('MEETING_TABLE');
    });

    it('enforces 10 MB maximum image limit', () => {
      expect(MAX_IMAGE_SIZE_BYTES).toBe(10 * 1024 * 1024);
    });

    it('allows only PNG, JPEG, and WebP formats', () => {
      expect(ALLOWED_MIME_TYPES.has('image/png')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('image/jpeg')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('image/webp')).toBe(true);
      expect(ALLOWED_MIME_TYPES.has('image/svg+xml')).toBe(false);
      expect(ALLOWED_MIME_TYPES.has('application/pdf')).toBe(false);
    });

    it('parses JSON wrapped in markdown code fences', () => {
      const markdown = '```json\n{"rooms": [{"name": "Test", "type": "OFFICE"}]}\n```';
      const parsed = parseJsonFromResponse(markdown);
      expect(parsed.rooms[0].name).toBe('Test');
    });

    it('parses raw JSON strings cleanly', () => {
      const raw = '{"rooms": []}';
      expect(parseJsonFromResponse(raw)).toEqual({ rooms: [] });
    });
  });

  describe('normalizeAiLayout - Room Center Coordinates (x, z)', () => {
    it('treats room (x, z) as geometric centre and binds objects inside bounds', () => {
      const raw = {
        building: { name: 'Engineering HQ' },
        rooms: [
          {
            name: 'Boardroom',
            type: 'MEETING',
            x: 0,
            z: 0,
            width: 6, // extends from x: -3 to +3
            depth: 4, // extends from z: -2 to +2
          },
        ],
        objects: [
          {
            assetType: 'MEETING_TABLE',
            x: 1, // inside [-3, 3]
            z: 0.5, // inside [-2, 2]
          },
          {
            assetType: 'DESK_STANDARD',
            x: 10, // outside room bounds
            z: 10,
          },
        ],
      };

      const normalized = normalizeAiLayout(raw);
      expect(normalized.schemaVersion).toBe(2);
      expect(normalized.rooms.length).toBe(1);
      const room = normalized.rooms[0];

      // Room x and z must be the exact centre coordinates
      expect(room.x).toBe(0);
      expect(room.z).toBe(0);
      expect(room.width).toBe(6);
      expect(room.depth).toBe(4);

      // Object inside room is bound to roomId
      expect(normalized.objects[0].roomId).toBe(room.id);
      // Object outside room is not bound
      expect(normalized.objects[1].roomId).toBeNull();
    });

    it('maps legacy CONFERENCE room type to MEETING', () => {
      const raw = {
        rooms: [{ name: 'Conference A', type: 'CONFERENCE', x: 2, z: 4, width: 5, depth: 5 }],
      };
      const normalized = normalizeAiLayout(raw);
      expect(normalized.rooms[0].type).toBe('MEETING');
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

    it('fails when base64Image is missing', async () => {
      const res = await handleReconstructionRequest({}, 'fake-key');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('No image data provided');
    });

    it('rejects unsupported image MIME types (e.g. PDF or SVG)', async () => {
      const res = await handleReconstructionRequest(
        {
          base64Image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
          mimeType: 'image/svg+xml',
        },
        'gsk_test'
      );
      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
      expect(res.error).toContain('Unsupported image format');
    });

    it('rejects image payloads exceeding 10 MB', async () => {
      // 14 MB base64 string exceeds 10 MB binary
      const largeBase64 = 'A'.repeat(15 * 1024 * 1024);
      const res = await handleReconstructionRequest(
        {
          base64Image: `data:image/png;base64,${largeBase64}`,
          mimeType: 'image/png',
        },
        'gsk_test'
      );
      expect(res.ok).toBe(false);
      expect(res.status).toBe(413);
      expect(res.error).toContain('exceeds maximum allowed size of 10 MB');
    });

    it('successfully calls Groq Vision API with Qwen 3.8 27B model', async () => {
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

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => groqResponse,
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await handleReconstructionRequest(
        { base64Image: 'data:image/jpeg;base64,1234' },
        'gsk_test_key_12345'
      );

      expect(res.ok).toBe(true);
      expect(res.modelUsed).toBe('groq/qwen/qwen3.8-27b');
      expect(res.layout.rooms[0].name).toBe('Open Office');
      expect(res.layout.rooms[0].x).toBe(0);
      expect(res.layout.rooms[0].z).toBe(0);
    });

    it('sends Gemini API key ONLY in x-goog-api-key header, NEVER in URL', async () => {
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    building: { name: 'Gemini HQ' },
                    rooms: [{ name: 'Lab', type: 'OFFICE', x: 0, z: 0, width: 5, depth: 5 }],
                    objects: [],
                  }),
                },
              ],
            },
          },
        ],
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => geminiResponse,
      });
      vi.stubGlobal('fetch', fetchMock);

      const apiKey = 'test-gemini-secret-key';
      const res = await handleReconstructionRequest(
        { base64Image: 'data:image/png;base64,1234' },
        apiKey
      );

      expect(res.ok).toBe(true);
      const callArgs = fetchMock.mock.calls[0];
      const url = callArgs[0];
      const headers = callArgs[1].headers;

      // URL MUST NOT leak the key in query params
      expect(url).not.toContain(apiKey);
      expect(url).not.toContain('?key=');
      // Key MUST be in headers
      expect(headers['x-goog-api-key']).toBe(apiKey);
    });

    it('returns an honest error (ok: false) when the AI vision call fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API key' } }),
      }));

      const res = await handleReconstructionRequest(
        { base64Image: 'data:image/png;base64,1234' },
        'gsk_bad_key'
      );

      expect(res.ok).toBe(false);
      expect(res.status).toBe(502);
      expect(res.error).toContain('AI vision reconstruction failed');
    });
  });
});

