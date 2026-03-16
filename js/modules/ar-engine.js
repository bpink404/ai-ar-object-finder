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

const FALLBACK_DEPTH = 1.5; // meters along ray when no surface hit
const LABEL_HEIGHT = 0.012; // screen-space height (sizeAttenuation off)

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

      XR8.addCameraPipelineModule(fullWindowCanvasModule());
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

  // Try the ground plane, but only use it if the hit is within a reasonable
  // distance — otherwise the label ends up on the floor out of view.
  const hits = raycaster.intersectObject(groundPlane);
  if (hits.length > 0 && hits[0].distance < 4) {
    position = hits[0].point.clone();
    position.y += 0.15;
    precise = true;
  } else {
    // Place along the ray at a fixed depth in front of the camera
    position = new THREE.Vector3();
    raycaster.ray.at(FALLBACK_DEPTH, position);
  }

  activeLabel = createBubbleSprite(text);
  activeLabel.position.copy(position);

  // sizeAttenuation is off, so scale is in screen-relative units
  const aspect = 512 / 192;
  activeLabel.scale.set(LABEL_HEIGHT * aspect, LABEL_HEIGHT, 1);
  activeLabel.renderOrder = 999;
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

/** Replicates XRExtras.FullWindowCanvas — computes canvas buffer size from
 *  both the viewport and camera video dimensions so the feed fills the
 *  screen with correct aspect-ratio cropping. Based on 8th Wall's own
 *  open-source implementation. */
function fullWindowCanvasModule() {
  let canvas_ = null;
  const vsize_ = { w: 0, h: 0 };
  let orientation_ = 0;

  const canvasStyle_ = {
    width: '100%',
    height: '100%',
    margin: '0px',
    padding: '0px',
    border: '0px',
    display: 'block',
  };

  const fillScreen = () => {
    if (!canvas_) return;

    const ww = window.innerWidth * devicePixelRatio;
    const wh = window.innerHeight * devicePixelRatio;

    // Wait for orientation change to settle
    const mismatch =
      ((orientation_ === 0 || orientation_ === 180) && ww > wh) ||
      ((orientation_ === 90 || orientation_ === -90) && wh > ww);
    if (mismatch) {
      window.requestAnimationFrame(fillScreen);
      return;
    }

    // Portrait-oriented window dimensions
    const ph = Math.max(ww, wh);
    const pw = Math.min(ww, wh);
    const pa = ph / pw;

    // Portrait-oriented video dimensions
    const pvh = Math.max(vsize_.w, vsize_.h);
    const pvw = Math.min(vsize_.w, vsize_.h);

    // Compute crop to fill screen (cover mode)
    let cw = Math.round(pvh / pa);
    let ch = pvh;
    if (cw > pvw) {
      cw = pvw;
      ch = Math.round(pvw * pa);
    }

    // Cap to screen resolution
    if (cw > pw || ch > ph) { cw = pw; ch = ph; }

    // Flip back to landscape if needed
    if (ww > wh) { const t = cw; cw = ch; ch = t; }

    Object.assign(canvas_.style, canvasStyle_);
    canvas_.width = cw;
    canvas_.height = ch;
  };

  const updateVideo = ({ videoWidth, videoHeight }) => {
    vsize_.w = videoWidth;
    vsize_.h = videoHeight;
  };

  return {
    name: 'fullwindowcanvas',
    onAttach: ({ canvas, orientation, videoWidth, videoHeight }) => {
      canvas_ = canvas;
      orientation_ = orientation || 0;
      Object.assign(canvas_.style, canvasStyle_);
      updateVideo({ videoWidth: videoWidth || 0, videoHeight: videoHeight || 0 });
      window.addEventListener('resize', fillScreen);
      fillScreen();
    },
    onDetach: () => {
      window.removeEventListener('resize', fillScreen);
      canvas_ = null;
    },
    onCameraStatusChange: ({ status, video }) => {
      if (status === 'hasVideo' && video) updateVideo(video);
    },
    onVideoSizeChange: ({ videoWidth, videoHeight }) => {
      updateVideo({ videoWidth, videoHeight });
      fillScreen();
    },
    onDeviceOrientationChange: ({ orientation }) => {
      orientation_ = orientation;
      fillScreen();
    },
    onCanvasSizeChange: () => { fillScreen(); },
    onUpdate: () => {
      if (!canvas_) return;
      if (canvas_.style.width !== canvasStyle_.width ||
          canvas_.style.height !== canvasStyle_.height) {
        fillScreen();
      }
    },
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

/** Draw a high-visibility neon label on an offscreen canvas and return a
 *  THREE.Sprite. Uses sizeAttenuation: false so it stays readable at any
 *  distance. */
function createBubbleSprite(text) {
  const canvas = document.createElement('canvas');
  const dpr = 2;
  const w = 512;
  const h = 192;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = 16;
  const radius = 20;
  const bx = pad;
  const by = pad;
  const bw = w - pad * 2;
  const bh = h - pad * 2;

  // Outer glow
  ctx.shadowColor = '#00ff88';
  ctx.shadowBlur = 24;

  // Background
  ctx.fillStyle = 'rgba(0, 20, 10, 0.88)';
  roundRect(ctx, bx, by, bw, bh, radius);
  ctx.fill();

  ctx.shadowBlur = 0;

  // Bright border
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 3;
  roundRect(ctx, bx, by, bw, bh, radius);
  ctx.stroke();

  // Inner accent line
  ctx.strokeStyle = 'rgba(0, 255, 136, 0.3)';
  ctx.lineWidth = 1;
  roundRect(ctx, bx + 4, by + 4, bw - 8, bh - 8, radius - 3);
  ctx.stroke();

  // Pin icon (small triangle at bottom center)
  const triSize = 12;
  ctx.fillStyle = '#00ff88';
  ctx.beginPath();
  ctx.moveTo(w / 2 - triSize, by + bh);
  ctx.lineTo(w / 2 + triSize, by + bh);
  ctx.lineTo(w / 2, by + bh + triSize);
  ctx.closePath();
  ctx.fill();

  // Label text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Text shadow for readability
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  const maxWidth = bw - 32;
  let displayText = text;
  if (ctx.measureText(text).width > maxWidth) {
    while (ctx.measureText(displayText + '…').width > maxWidth && displayText.length > 1) {
      displayText = displayText.slice(0, -1);
    }
    displayText += '…';
  }
  ctx.fillText(displayText, w / 2, h / 2 - 2);

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: false,
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
