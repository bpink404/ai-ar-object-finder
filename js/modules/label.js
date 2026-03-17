/**
 * Shared label rendering — creates Three.js sprites with a high-visibility
 * neon-green bubble and pin pointer. Used by both the 8th Wall and WebXR
 * AR engine adapters.
 */

const LABEL_HEIGHT = 0.07;
const LABEL_ASPECT = 512 / 192;

function createBubbleSprite(text) {
  const THREE = window.THREE;
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

  ctx.shadowColor = '#00ff44';
  ctx.shadowBlur = 28;

  ctx.fillStyle = '#00ee44';
  roundRect(ctx, bx, by, bw, bh, radius);
  ctx.fill();

  ctx.shadowBlur = 0;

  ctx.strokeStyle = '#009922';
  ctx.lineWidth = 3;
  roundRect(ctx, bx, by, bw, bh, radius);
  ctx.stroke();

  const triSize = 14;
  ctx.fillStyle = '#00ee44';
  ctx.shadowColor = '#00ff44';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(w / 2 - triSize, by + bh - 1);
  ctx.lineTo(w / 2 + triSize, by + bh - 1);
  ctx.lineTo(w / 2, by + bh + triSize + 2);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#003300';
  ctx.font = 'bold 48px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = bw - 32;
  let displayText = text;
  if (ctx.measureText(text).width > maxWidth) {
    while (ctx.measureText(displayText + '…').width > maxWidth && displayText.length > 1) {
      displayText = displayText.slice(0, -1);
    }
    displayText += '…';
  }
  ctx.fillText(displayText, w / 2, h / 2 - 2);

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

function applyLabelScale(sprite) {
  sprite.scale.set(LABEL_HEIGHT * LABEL_ASPECT, LABEL_HEIGHT, 1);
  sprite.renderOrder = 999;
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

export { createBubbleSprite, applyLabelScale };
