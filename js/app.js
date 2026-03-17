/**
 * App controller — state machine that wires the UI, detection, and AR modules.
 *
 * States
 * ------
 *   idle            Landing screen visible
 *   camera-starting AR engine initializing
 *   ready           Camera running, user can type + tap Find
 *   searching       Gemini detection in progress
 *   found           Label anchored in AR scene
 *
 * Supports two AR backends (selectable on landing screen):
 *   - 8th Wall (works on all mobile browsers including Safari iOS)
 *   - WebXR   (Chrome/Samsung/Edge on Android via ARCore)
 */

import * as engine8w from './modules/ar-engine.js';
import * as engineXR from './modules/ar-engine-webxr.js';
import * as detection from './modules/detection.js';
import * as ui from './modules/ui.js';

let state = 'idle';
let arEngine = null;

function setState(next) {
  state = next;
  ui.setARState(next);
}

// ---- Callbacks from UI ------------------------------------------------

async function handleStart(apiKey, modelKey, engineKey) {
  detection.init(apiKey, modelKey);

  arEngine = engineKey === 'webxr' ? engineXR : engine8w;

  ui.showAR();
  setState('camera-starting');
  ui.setModelBadge(detection.getModelLabel());
  ui.setStatus(`Starting camera (${engineKey === 'webxr' ? 'WebXR' : '8th Wall'})…`);
  ui.setFindEnabled(false);
  ui.setDeleteVisible(false);

  try {
    await arEngine.start();
    setState('ready');
    ui.setStatus('Camera ready — type an object name and tap Find');
    ui.setFindEnabled(true);
    ui.focusObjectInput();
  } catch (err) {
    console.error('AR start failed:', err);
    ui.setStatus(`Camera error: ${err.message}`, 'error');
  }
}

async function handleFind(objectName) {
  if (state === 'searching') return;

  setState('searching');
  ui.setFindEnabled(false);
  ui.setDeleteVisible(false);
  ui.setStatus(`Searching for "${objectName}"…`, 'searching');

  arEngine.removeLabel();

  try {
    const frame = await arEngine.captureFrame();
    const result = await detection.detect(frame, objectName);

    if (!result.found) {
      setState('ready');
      ui.setStatus(`"${objectName}" not found — try again`, 'error');
      ui.setFindEnabled(true);
      return;
    }

    const { precise } = arEngine.placeLabel(result.box, objectName);

    setState('found');
    const anchor = precise ? 'anchored on surface' : 'anchored (approximate depth)';
    ui.setStatus(`Found "${objectName}" — ${anchor}`, 'found');
    ui.setFindEnabled(true);
    ui.setDeleteVisible(true);
  } catch (err) {
    console.error('Detection failed:', err);
    setState('ready');
    ui.setStatus(`Detection error: ${err.message}`, 'error');
    ui.setFindEnabled(true);
  }
}

function handleDelete() {
  arEngine.removeLabel();
  setState('ready');
  ui.setStatus('Label removed — search for another object');
  ui.setDeleteVisible(false);
  ui.focusObjectInput();
}

function handleClose() {
  if (arEngine) arEngine.stop();
  arEngine = null;
  setState('idle');
  ui.showIdle();
}

// ---- Bootstrap --------------------------------------------------------

ui.wireEvents();
ui.bindCallbacks({
  onStart: handleStart,
  onFind: handleFind,
  onDelete: handleDelete,
  onClose: handleClose,
});
