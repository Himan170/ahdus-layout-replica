/**
 * server/aiReconstructionHandler.js
 *
 * Server-side AI floor plan reconstruction supporting multiple Vision providers:
 * - Groq (Qwen 3.8 27B Multimodal Vision)
 * - OpenRouter (Gemini 2.5 Flash via unified API)
 * - OpenAI (GPT-4o-mini Vision)
 * - Google Gemini (Gemini 2.5 Flash / 2.0 Flash / 1.5 Flash)
 *
 * Analyzes uploaded floorplan photos or blueprints, extracts architectural
 * room boundaries and furniture, and outputs validated Layout v2 JSON.
 */

import { LayoutSchema } from '../src/engine/model/schema';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Maximum allowed image payload: 10 Megabytes (binary).
 */
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Allowed image MIME types.
 */
export const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Valid room types matching RoomTypeSchema in src/engine/model/schema.ts
 */
export const VALID_ROOM_TYPES = [
  'OFFICE', 'MEETING', 'RECEPTION', 'CORRIDOR', 'PRODUCTION',
  'STAIRCASE', 'SERVER_ROOM', 'RESTROOM', 'CUSTOM'
];

/**
 * Valid asset types matching keys in src/utils/assetCatalog.js
 */
export const VALID_ASSET_TYPES = [
  'DESK_STANDARD', 'OFFICE_CHAIR', 'MEETING_TABLE', 'FILING_CABINET',
  'WHITEBOARD', 'SOFA', 'COFFEE_TABLE', 'WATER_COOLER', 'PLANT', 'BOOKSHELF'
];

/**
 * The system instruction for Vision models to extract structured CAD data.
 * Crucially specifies that (x, z) is strictly the GEOMETRIC CENTRE of each room.
 */
export const RECONSTRUCTION_PROMPT = `
You are an expert architectural blueprint and office floorplan reconstruction AI for a 3D digital twin platform.
Analyze this floor plan image and detect all rooms, walls, doors, and furniture items.

COORDINATE SYSTEM:
- Units are strictly in METERS.
- Origin (0, 0) is at the center of the building.
- For each room, (x, z) is strictly the GEOMETRIC CENTRE of the room in meters (NOT a corner).
- Room bounding box: X spans [x - width/2, x + width/2], and Z spans [z - depth/2, z + depth/2].
- X is horizontal width (left to right).
- Z is vertical depth (top to bottom).
- Standard interior wall height is 3.0 meters.
- Standard room dimensions: Small office (3m x 3m to 4m x 5m), Meeting room (5m x 6m), Reception (6m x 6m).
- Standard desk dimensions: ~1.4m x 0.8m.

ALLOWED ROOM TYPES (type must strictly be one of these):
["OFFICE", "MEETING", "RECEPTION", "CORRIDOR", "PRODUCTION", "STAIRCASE", "SERVER_ROOM", "RESTROOM", "CUSTOM"]

ALLOWED FURNITURE ASSET TYPES (assetType must strictly be one of these):
["DESK_STANDARD", "OFFICE_CHAIR", "MEETING_TABLE", "FILING_CABINET", "WHITEBOARD", "SOFA", "COFFEE_TABLE", "WATER_COOLER", "PLANT", "BOOKSHELF"]

INSTRUCTIONS:
1. Identify all distinct rooms. For each room provide:
   - name: clear descriptive name (e.g., "Conference Room", "Engineering Office", "Reception")
   - type: one of the allowed room types above (map any conference room to "MEETING")
   - x, z: coordinates of the geometric room CENTRE in meters
   - width, depth: room width and depth in meters (must be >= 1.5m)
2. Identify all detected furniture and place them inside their room bounds:
   - assetType: one of the allowed asset types above
   - x, z: coordinate of the object (must be inside its room bounds [x - width/2, x + width/2] and [z - depth/2, z + depth/2])
   - rotationY: rotation angle in radians (0, 1.57, 3.14, 4.71)
3. Return ONLY a valid JSON object matching this structure:
{
  "building": { "name": "Reconstructed Office" },
  "rooms": [
    {
      "name": "Meeting Room",
      "type": "MEETING",
      "x": 0,
      "z": 0,
      "width": 6,
      "depth": 5,
      "wallHeight": 3
    }
  ],
  "objects": [
    {
      "assetType": "MEETING_TABLE",
      "x": 0,
      "z": 0,
      "rotationY": 0
    }
  ]
}
`.trim();

/**
 * Normalizes raw model output to strictly conform to LayoutSchema (Layout v2).
 * Enforces room (x, z) as geometric centre and validates object containment.
 */
export function normalizeAiLayout(raw = {}) {
  const ts = Date.now();
  const validRoomTypes = new Set(VALID_ROOM_TYPES);
  const validAssetTypes = new Set(VALID_ASSET_TYPES);

  const rawRooms = Array.isArray(raw.rooms) ? raw.rooms : [];
  const rooms = rawRooms.map((r, i) => {
    let rawType = String(r.type || 'OFFICE').toUpperCase();
    if (rawType === 'CONFERENCE') rawType = 'MEETING';
    const type = validRoomTypes.has(rawType) ? rawType : 'OFFICE';
    const id = r.id || `room_${ts}_${i + 1}`;
    const width = Math.max(1.5, Number(r.width) || 4);
    const depth = Math.max(1.5, Number(r.depth) || 4);
    const wallHeight = Number(r.wallHeight) || 3;

    // (x, z) is strictly the room centre
    const cx = Number(r.x) || 0;
    const cz = Number(r.z) || 0;

    return {
      id,
      floorId: '0',
      name: r.name || `Room ${i + 1}`,
      type,
      x: cx,
      z: cz,
      width,
      depth,
      wallHeight,
      wallThickness: 0.15,
      color: r.color || (type === 'MEETING' ? '#8b5cf6' : type === 'RECEPTION' ? '#f59e0b' : '#3b82f6'),
      floorFinish: r.floorFinish || 'default',
    };
  });

  const rawObjects = Array.isArray(raw.objects) ? raw.objects : [];
  const objects = rawObjects.map((o, i) => {
    const rawAsset = String(o.assetType || 'DESK_STANDARD').toUpperCase();
    const assetType = validAssetTypes.has(rawAsset) ? rawAsset : 'DESK_STANDARD';
    const id = o.id || `obj_${ts}_${i + 1}`;

    // Find parent room: object must fall within [centre.x - width/2, centre.x + width/2]
    const ox = Number(o.x ?? o.position?.x) || 0;
    const oz = Number(o.z ?? o.position?.z) || 0;
    const parentRoom = rooms.find((rm) => {
      const halfW = rm.width / 2;
      const halfD = rm.depth / 2;
      return ox >= rm.x - halfW && ox <= rm.x + halfW && oz >= rm.z - halfD && oz <= rm.z + halfD;
    });

    return {
      id,
      floorId: '0',
      roomId: o.roomId || parentRoom?.id || null,
      assetType,
      x: ox,
      y: 0,
      z: oz,
      rotationY: Number(o.rotationY) || 0,
      scale: { x: 1, y: 1, z: 1 },
      label: o.label || o.name || assetType.replace(/_/g, ' ').toLowerCase(),
      department: o.department || '',
      locked: false,
      metadata: {},
    };
  });

  return {
    schemaVersion: 2,
    units: 'meters',
    building: {
      name: raw.building?.name || 'Reconstructed Office',
      address: raw.building?.address || '',
      northAngle: Number(raw.building?.northAngle) || 0,
    },
    floors: [{ id: '0', name: 'Ground Floor', height: 3.5 }],
    rooms,
    openings: [],
    objects,
    anchors: [],
    routes: [],
    floorLinks: [],
  };
}

/**
 * Reliably extracts and parses JSON from model responses, handling markdown code fences.
 */
export function parseJsonFromResponse(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Empty or invalid response content from AI model');
  }
  let clean = text.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(clean);
}

/**
 * Calls Groq Vision API using active multimodal model (Qwen 3.8 27B).
 */
export async function callGroqVision(base64Data, mimeType, apiKey) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  const models = ['qwen/qwen3.8-27b'];
  let lastError = null;

  for (const model of models) {
    try {
      const payload = {
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: RECONSTRUCTION_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.1,
      };

      let res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...payload, response_format: { type: 'json_object' } }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
        if (errMsg.toLowerCase().includes('response_format')) {
          res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
          });
        } else {
          lastError = new Error(`Groq model ${model} error: ${errMsg}`);
          continue;
        }
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
        lastError = new Error(`Groq model ${model} error: ${errMsg}`);
        continue;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error(`Groq model ${model} returned empty response`);

      const parsed = parseJsonFromResponse(text);
      return { data: parsed, modelUsed: `groq/${model}` };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All Groq vision models failed');
}

/**
 * Calls OpenRouter Vision API (Gemini 2.5 Flash via OpenRouter).
 */
export async function callOpenRouterVision(base64Data, mimeType, apiKey) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: RECONSTRUCTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    throw new Error(`OpenRouter error (${res.status}): ${errJson?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenRouter returned empty response');
  const parsed = parseJsonFromResponse(text);
  return { data: parsed, modelUsed: 'openrouter/google/gemini-2.5-flash' };
}

/**
 * Calls OpenAI Vision API (GPT-4o-mini).
 */
export async function callOpenAIVision(base64Data, mimeType, apiKey) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: RECONSTRUCTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    throw new Error(`OpenAI API error (${res.status}): ${errJson?.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned empty response');
  const parsed = parseJsonFromResponse(text);
  return { data: parsed, modelUsed: 'openai/gpt-4o-mini' };
}

/**
 * Executes a Gemini Vision API call.
 * SECURITY: The API key is sent ONLY in the x-goog-api-key header, never in the URL.
 */
export async function callGeminiVision(base64Data, mimeType, apiKey) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastError = null;

  for (const model of models) {
    // API key passed strictly in the header, never as a query parameter
    const url = `${GEMINI_API_BASE}/${model}:generateContent`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: RECONSTRUCTION_PROMPT },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.2,
          },
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
        lastError = new Error(`Model ${model} returned: ${errMsg}`);
        continue;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned empty response content');
      }

      const parsed = parseJsonFromResponse(text);
      return { data: parsed, modelUsed: model };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('All Gemini Vision models failed');
}

/**
 * Dispatches the image analysis to configured providers.
 */
export async function dispatchVisionAnalysis(base64Data, mimeType, keys = {}) {
  const { groqKey, openrouterKey, openaiKey, geminiKey } = keys;

  if (groqKey) {
    try {
      return await callGroqVision(base64Data, mimeType, groqKey);
    } catch (err) {
      if (!openrouterKey && !openaiKey && !geminiKey) throw err;
    }
  }

  if (openrouterKey) {
    try {
      return await callOpenRouterVision(base64Data, mimeType, openrouterKey);
    } catch (err) {
      if (!openaiKey && !geminiKey) throw err;
    }
  }

  if (openaiKey) {
    try {
      return await callOpenAIVision(base64Data, mimeType, openaiKey);
    } catch (err) {
      if (!geminiKey) throw err;
    }
  }

  if (geminiKey) {
    return await callGeminiVision(base64Data, mimeType, geminiKey);
  }

  throw new Error('No valid AI Vision API key configured (please add GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY to .env.local).');
}

/**
 * Handles POST /api/ai/reconstruct requests.
 *
 * @param {object} params
 * @param {string} [params.base64Image]
 * @param {string} [params.mimeType]
 * @param {string|object} [apiConfig]
 * @returns {Promise<{ ok: boolean, layout?: object, detectionStats?: object, modelUsed?: string, error?: string, status?: number }>}
 */
export async function handleReconstructionRequest(params = {}, apiConfig = undefined) {
  let openrouterKey = '';
  let groqKey = '';
  let openaiKey = '';
  let geminiKey = '';

  if (typeof apiConfig === 'string') {
    if (apiConfig.startsWith('sk-or-')) openrouterKey = apiConfig;
    else if (apiConfig.startsWith('gsk_')) groqKey = apiConfig;
    else if (apiConfig.startsWith('sk-')) openaiKey = apiConfig;
    else geminiKey = apiConfig;
  } else if (typeof apiConfig === 'object' && apiConfig !== null) {
    openrouterKey = apiConfig.openrouterApiKey || '';
    groqKey = apiConfig.groqApiKey || '';
    openaiKey = apiConfig.openaiApiKey || '';
    geminiKey = apiConfig.geminiApiKey || '';
  } else {
    openrouterKey = process.env.OPENROUTER_API_KEY || '';
    groqKey = process.env.GROQ_API_KEY || '';
    openaiKey = process.env.OPENAI_API_KEY || '';
    geminiKey = process.env.GEMINI_API_KEY || '';
  }

  if (apiConfig === '' || (!openrouterKey && !groqKey && !openaiKey && !geminiKey)) {
    return {
      ok: false,
      status: 500,
      error: 'No AI Vision API key configured. Please add GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY to .env.local.',
    };
  }

  try {
    let base64Data = params.base64Image || '';
    let rawMime = params.mimeType || 'image/png';

    if (base64Data.startsWith('data:')) {
      const commaIdx = base64Data.indexOf(',');
      const meta = base64Data.slice(0, commaIdx);
      const mimeMatch = meta.match(/data:([^;]+)/);
      if (mimeMatch) rawMime = mimeMatch[1];
      base64Data = base64Data.slice(commaIdx + 1);
    }

    if (!base64Data) {
      return {
        ok: false,
        status: 400,
        error: 'No image data provided (base64Image required)',
      };
    }

    // 1. Enforce allowed image format (PNG, JPEG, WebP)
    let mimeType = rawMime.toLowerCase().trim();
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return {
        ok: false,
        status: 400,
        error: `Unsupported image format (${mimeType}). Only PNG, JPEG, and WebP images are allowed.`,
      };
    }

    // 2. Enforce 10 MB payload size limit
    const approxByteSize = Math.floor((base64Data.length * 3) / 4);
    if (approxByteSize > MAX_IMAGE_SIZE_BYTES) {
      return {
        ok: false,
        status: 413,
        error: `Image exceeds maximum allowed size of 10 MB (${(approxByteSize / (1024 * 1024)).toFixed(1)} MB provided).`,
      };
    }

    // 3. Dispatch to Vision provider
    let rawLayout;
    let modelUsed;
    try {
      const visionRes = await dispatchVisionAnalysis(base64Data, mimeType, {
        groqKey,
        openrouterKey,
        openaiKey,
        geminiKey,
      });
      rawLayout = visionRes.data;
      modelUsed = visionRes.modelUsed;
    } catch (err) {
      // Return honest failure when AI fails
      return {
        ok: false,
        status: 502,
        error: `AI vision reconstruction failed: ${err.message}`,
      };
    }

    // 4. Normalize to strict Layout v2 schema
    const normalized = normalizeAiLayout(rawLayout);

    // 5. Validate with Zod LayoutSchema
    const parseResult = LayoutSchema.safeParse(normalized);
    if (!parseResult.success) {
      return {
        ok: false,
        status: 422,
        error: `AI layout schema validation failed: ${parseResult.error.issues.map((i) => i.message).join(', ')}`,
      };
    }

    return {
      ok: true,
      layout: parseResult.data,
      detectionStats: {
        floorCount: parseResult.data.floors.length,
        roomCount: parseResult.data.rooms.length,
        objectCount: parseResult.data.objects.length,
        anchorCount: parseResult.data.anchors.length,
        routeCount: parseResult.data.routes.length,
      },
      modelUsed,
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err.message || 'Internal AI reconstruction failure',
    };
  }
}

