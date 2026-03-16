/**
 * AR Engine adapter — wraps 8th Wall + Three.js.
 *
 * Responsibilities:
 *   - Start / stop 8th Wall SLAM world tracking
 *   - Provide frame capture (base64 JPEG via CanvasScreenshot)
 *   - Convert 2D bounding-box center → 3D world position (raycast)
 *   - Render and manage a single floating text-bubble sprite
 *
 * This module is the only place that touches XR8 or THREE globals,
 * making it swappable for a different AR backend later.
 */

let scene, camera, renderer;
let groundPlane;
let raycaster;
let activeLabel = null;
let trackingStatus = 'LIMITED';

const FALLBACK_DEPTH = 2.0; // meters along ray when no surface hit
const LABEL_SCALE = 0.35;

// ---- Public API -------------------------------------------------------

/** Start the 8th Wall camera + SLAM pipeline. Returns a promise that
 *  resolves once the camera is streaming. */
async function start() {
  if (typeof XR8 === 'undefined') {
    throw new Error('8th Wall XR engine not loaded. Make sure xr/xr.js exists.');
  }

  // Three.js is loaded via an ES module in index.html. Wait for it if needed.
  if (!window.THREE) {
    await waitForThree(5000);
  }
  if (!window.THREE) {
    throw new Error('Three.js failed to load. Check network/console for errors.');
  }

  return new Promise((resolve, reject) => {
    try {
      const canvas = document.getElementById('camerafeed');

      XR8.addCameraPipelineModule(fullWindowCanvasModule(canvas));
      XR8.addCameraPipelineModule(XR8.GlTextureRenderer.pipelineModule());
      XR8.addCameraPipelineModule(XR8.Threejs.pipelineModule());
      XR8.addCameraPipelineModule(XR8.XrController.pipelineModule());
      XR8.addCameraPipelineModule(XR8.CanvasScreenshot.pipelineModule());
      XR8.addCameraPipelineModule(lifecycleModule(resolve));

      XR8.XrController.configure({ disableWorldTracking: false });

      XR8.run({ canvas });
    } catch (err) {
      reject(err);
    }
  });
}

function waitForThree(timeoutMs) {
  return new Promise((resolve) => {
    if (window.THREE) { resolve(); return; }
    const start = Date.now();
    const check = setInterval(() => {
      if (window.THREE || Date.now() - start > timeoutMs) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
}

/** Stop the AR session and clean up. */
function stop() {
  removeLabel();
  try { XR8.stop(); } catch (_) { /* may already be stopped */ }
  try { XR8.clearCameraPipelineModules(); } catch (_) { /* ok */ }
  scene = camera = renderer = groundPlane = raycaster = null;
  trackingStatus = 'LIMITED';
}

/** Capture the current camera+scene view as a base64 JPEG string. */
async function captureFrame() {
  return XR8.CanvasScreenshot.takeScreenshot();
}

/** Place a floating label in 3D space at the center of a bounding box.
 *  @param {number[]} box - [ymin, xmin, ymax, xmax] normalized 0-1000
 *  @param {string}   text - the label to display
 *  @returns {{ precise: boolean }} whether the anchor hit a real surface */
function placeLabel(box, text) {
  removeLabel();

  const cx = (box[1] + box[3]) / 2000;
  const cy = (box[0] + box[2]) / 2000;

  const ndc = { x: cx * 2 - 1, y: -(cy * 2 - 1) };
  raycaster.setFromCamera(ndc, camera);

  let position;
  let precise = false;

  const hits = raycaster.intersectObject(groundPlane);
  if (hits.length > 0) {
    position = hits[0].point.clone();
    // Lift the label slightly above the surface
    position.y += 0.12;
    precise = true;
  } else {
    position = new THREE.Vector3();
    raycaster.ray.at(FALLBACK_DEPTH, position);
  }

  activeLabel = createBubbleSprite(text);
  activeLabel.position.copy(position);
  activeLabel.scale.set(LABEL_SCALE, LABEL_SCALE * 0.5, 1);
  scene.add(activeLabel);

  return { precise };
}

/** Remove the current label from the scene. */
function removeLabel() {
  if (activeLabel) {
    scene.remove(activeLabel);
    if (activeLabel.material.map) activeLabel.material.map.dispose();
    activeLabel.material.dispose();
    activeLabel = null;
  }
}

/** @returns {boolean} whether SLAM tracking is in NORMAL state */
function isTrackingNormal() {
  return trackingStatus === 'NORMAL';
}

export { start, stop, captureFrame, placeLabel, removeLabel, isTrackingNormal };

// ---- Internals --------------------------------------------------------

/** Replicates XRExtras.FullWindowCanvas — sizes the canvas buffer and CSS
 *  to fill the viewport on start and on resize/orientation change. */
function fullWindowCanvasModule(canvas) {
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  };

  return {
    name: 'full-window-canvas',
    onBeforeRun: () => { resize(); },
    onAttach: () => {
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', resize);
    },
    onDetach: () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
    },
    onDeviceOrientationChangeEvent: () => { resize(); },
    onCanvasSizeChange: () => { resize(); },
  };
}

/** Custom pipeline module that wires up Three.js references and tracking. */
function lifecycleModule(onReady) {
  let resolved = false;
  return {
    name: 'ar-object-finder',
    onStart: () => {
      const xrScene = XR8.Threejs.xrScene();
      scene = xrScene.scene;
      camera = xrScene.camera;
      renderer = xrScene.renderer;

      raycaster = new THREE.Raycaster();

      const geo = new THREE.PlaneGeometry(100, 100);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ visible: false });
      groundPlane = new THREE.Mesh(geo, mat);
      scene.add(groundPlane);
    },
    onUpdate: ({ processCpuResult }) => {
      if (processCpuResult && processCpuResult.reality) {
        const ts = processCpuResult.reality.trackingStatus;
        if (ts) trackingStatus = ts;
      }
    },
    onCameraStatusChange: ({ status }) => {
      if (status === 'hasVideo' && !resolved) {
        resolved = true;
        onReady();
      }
    },
    listeners: [
      {
        event: 'reality.trackingstatus',
        process: ({ detail }) => {
          if (detail) trackingStatus = detail.status;
        },
      },
    ],
  };
}

/** Draw a rounded-rect text bubble on an offscreen canvas and return a
 *  THREE.Sprite using it as a texture. */
function createBubbleSprite(text) {
  const canvas = document.createElement('canvas');
  const dpr = 2;
  const w = 512;
  const h = 192;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = 20;
  const radius = 16;

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(79, 110, 247, 0.8)';
  ctx.lineWidth = 2;
  roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
  ctx.stroke();

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = w - pad * 4;
  let displayText = text;
  if (ctx.measureText(text).width > maxWidth) {
    while (ctx.measureText(displayText + '…').width > maxWidth && displayText.length > 1) {
      displayText = displayText.slice(0, -1);
    }
    displayText += '…';
  }
  ctx.fillText(displayText, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });

  return new THREE.Sprite(material);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
