/**
 * AR Engine adapter — WebXR implementation.
 *
 * Same public API as ar-engine.js (8th Wall) so app.js can swap freely.
 * Uses the WebXR Device API with the hit-test module (backed by ARCore
 * on Android) and Three.js for scene management.
 *
 * Frame capture for Gemini detection comes from a parallel getUserMedia
 * stream since WebXR composites the camera feed natively and doesn't
 * expose it to canvas.toDataURL().
 */

import { createBubbleSprite, applyLabelScale } from './label.js';

let scene, camera, renderer;
let xrSession = null;
let hitTestSource = null;
let hitTestSourceRequested = false;
let referenceSpace = null;
let lastHitMatrix = null;
let activeLabel = null;
let trackingStatus = 'LIMITED';
let videoStream = null;
let xrCanvas = null;

const FALLBACK_DEPTH = 1.2;

// ---- Public API -------------------------------------------------------

async function start() {
  const THREE = window.THREE;
  if (!THREE) throw new Error('Three.js not loaded.');

  if (!navigator.xr) {
    throw new Error('WebXR not supported in this browser.');
  }

  // Create a dedicated canvas for WebXR (separate from 8th Wall's #camerafeed)
  const container = document.getElementById('screen-ar');
  xrCanvas = document.createElement('canvas');
  xrCanvas.id = 'webxr-canvas';
  xrCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
  container.insertBefore(xrCanvas, container.firstChild);

  // Hide 8th Wall's canvas
  const eighthWallCanvas = document.getElementById('camerafeed');
  if (eighthWallCanvas) eighthWallCanvas.style.display = 'none';

  // Three.js renderer
  const gl = xrCanvas.getContext('webgl2', { xrCompatible: true }) ||
             xrCanvas.getContext('webgl', { xrCompatible: true });
  renderer = new THREE.WebGLRenderer({ canvas: xrCanvas, context: gl, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 3);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  // Request immersive-ar session with hit-test and dom-overlay
  const overlay = document.getElementById('ar-overlay');
  const sessionInit = {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: overlay },
  };

  xrSession = await navigator.xr.requestSession('immersive-ar', sessionInit);
  xrSession.addEventListener('end', onSessionEnd);

  referenceSpace = await xrSession.requestReferenceSpace('local');
  await renderer.xr.setSession(xrSession);

  renderer.setAnimationLoop(onFrame);

  // Parallel getUserMedia for frame capture (Gemini needs camera pixels)
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const videoEl = document.getElementById('webxr-video');
    videoEl.srcObject = videoStream;
    await videoEl.play();
  } catch (e) {
    console.warn('[webxr] getUserMedia for frame capture failed:', e);
  }

  trackingStatus = 'NORMAL';
}

function stop() {
  removeLabel();

  if (xrSession) {
    xrSession.end().catch(() => {});
    xrSession = null;
  }

  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
    videoStream = null;
    const videoEl = document.getElementById('webxr-video');
    if (videoEl) videoEl.srcObject = null;
  }

  if (renderer) {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer = null;
  }

  if (xrCanvas && xrCanvas.parentNode) {
    xrCanvas.parentNode.removeChild(xrCanvas);
    xrCanvas = null;
  }

  // Restore 8th Wall canvas visibility
  const eighthWallCanvas = document.getElementById('camerafeed');
  if (eighthWallCanvas) eighthWallCanvas.style.display = '';

  hitTestSource = null;
  hitTestSourceRequested = false;
  referenceSpace = null;
  lastHitMatrix = null;
  scene = camera = null;
  trackingStatus = 'LIMITED';
}

async function captureFrame() {
  const video = document.getElementById('webxr-video');
  if (!video || !video.videoWidth) {
    throw new Error('Video capture not available — getUserMedia may have been denied.');
  }
  const offscreen = document.createElement('canvas');
  offscreen.width = video.videoWidth;
  offscreen.height = video.videoHeight;
  const ctx = offscreen.getContext('2d');
  ctx.drawImage(video, 0, 0);
  return offscreen.toDataURL('image/jpeg', 0.85).split(',')[1];
}

function placeLabel(box, text) {
  removeLabel();

  const THREE = window.THREE;
  const cx = (box[1] + box[3]) / 2000;
  const cy = (box[0] + box[2]) / 2000;

  let position;
  let precise = false;

  // Estimate surface depth from the latest viewer-center hit test,
  // then cast a ray from the camera through the detection bbox center.
  let depth = FALLBACK_DEPTH;
  if (lastHitMatrix) {
    const hitPos = new THREE.Vector3();
    hitPos.setFromMatrixPosition(lastHitMatrix);
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    const d = hitPos.distanceTo(camPos);
    if (d > 0.1 && d < 10) {
      depth = d;
      precise = true;
    }
  }

  const ndc = new THREE.Vector2(cx * 2 - 1, -(cy * 2 - 1));
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  position = new THREE.Vector3();
  raycaster.ray.at(depth, position);

  activeLabel = createBubbleSprite(text);
  activeLabel.position.copy(position);
  applyLabelScale(activeLabel);
  scene.add(activeLabel);

  return { precise };
}

function removeLabel() {
  if (activeLabel && scene) {
    scene.remove(activeLabel);
    if (activeLabel.material.map) activeLabel.material.map.dispose();
    activeLabel.material.dispose();
    activeLabel = null;
  }
}

function isTrackingNormal() {
  return trackingStatus === 'NORMAL';
}

export { start, stop, captureFrame, placeLabel, removeLabel, isTrackingNormal };

// ---- Internals --------------------------------------------------------

function onFrame(timestamp, frame) {
  if (!frame) { renderer.render(scene, camera); return; }

  const session = renderer.xr.getSession();

  // Set up hit test source once per session
  if (!hitTestSourceRequested && session) {
    session.requestReferenceSpace('viewer').then((viewerSpace) => {
      session.requestHitTestSource({ space: viewerSpace }).then((source) => {
        hitTestSource = source;
      });
    });
    hitTestSourceRequested = true;
  }

  // Store the latest hit result matrix for placeLabel to use
  if (hitTestSource) {
    const results = frame.getHitTestResults(hitTestSource);
    if (results.length > 0) {
      const refSpace = renderer.xr.getReferenceSpace();
      const pose = results[0].getPose(refSpace);
      if (pose) {
        const THREE = window.THREE;
        if (!lastHitMatrix) lastHitMatrix = new THREE.Matrix4();
        lastHitMatrix.fromArray(pose.transform.matrix);
      }
      trackingStatus = 'NORMAL';
    }
  }

  renderer.render(scene, camera);
}

function onSessionEnd() {
  trackingStatus = 'LIMITED';
  hitTestSource = null;
  hitTestSourceRequested = false;
  lastHitMatrix = null;
}
