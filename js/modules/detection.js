/**
 * Detection module — calls Gemini directly from the browser for
 * open-vocabulary object detection with bounding boxes.
 *
 * Uses Google's @google/genai SDK loaded from CDN (esm.sh).
 * The user's API key never leaves the browser.
 *
 * Two models are available, selectable at init time:
 *   flash-lite  → gemini-3.1-flash-lite-preview  (fastest, default)
 *   flash       → gemini-3-flash-preview          (most accurate)
 */

import { GoogleGenAI } from 'https://esm.sh/@google/genai';

const MODELS = {
  'flash-lite': 'gemini-3.1-flash-lite-preview',
  'flash': 'gemini-3-flash-preview',
};

const DETECTION_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
      label: { type: 'STRING' },
    },
    required: ['box_2d', 'label'],
  },
};

const SYSTEM_INSTRUCTION =
  'Return bounding boxes as a JSON array with labels. Never return masks. ' +
  'Limit to 1 object — the single best match. ' +
  'Coordinates are normalized 0-1000 in [y_min, x_min, y_max, x_max] format.';

let ai = null;
let selectedModel = MODELS['flash-lite'];

/**
 * Initialize the detection module.
 * @param {string} apiKey - Gemini API key
 * @param {string} [modelKey='flash-lite'] - 'flash-lite' or 'flash'
 */
function init(apiKey, modelKey = 'flash-lite') {
  ai = new GoogleGenAI({ apiKey });
  selectedModel = MODELS[modelKey] || MODELS['flash-lite'];
}

/** @returns {string} human-readable name of the active model */
function getModelLabel() {
  if (selectedModel === MODELS['flash']) return 'Flash';
  return 'Flash-Lite';
}

/**
 * Detect a named object in a base64 JPEG image.
 * @param {string} base64Image - JPEG data (no data-URL prefix)
 * @param {string} targetObject - e.g. "printer", "coffee mug"
 * @returns {Promise<{ found: boolean, box?: number[], label?: string, raw: any }>}
 */
async function detect(base64Image, targetObject) {
  if (!ai) throw new Error('detection.init() has not been called');

  const response = await ai.models.generateContent({
    model: selectedModel,
    contents: [
      { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
      { text: `Detect the 2d bounding box of the "${targetObject}" in this image.` },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.5,
      responseMimeType: 'application/json',
      responseSchema: DETECTION_SCHEMA,
    },
  });

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return { found: false, raw: response.text };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { found: false, raw: parsed };
  }

  const best = parsed[0];
  if (
    !best.box_2d ||
    !Array.isArray(best.box_2d) ||
    best.box_2d.length !== 4
  ) {
    return { found: false, raw: parsed };
  }

  return {
    found: true,
    box: best.box_2d,
    label: best.label || targetObject,
    raw: parsed,
  };
}

export { init, detect, getModelLabel, MODELS };
