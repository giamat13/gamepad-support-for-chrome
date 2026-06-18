// Run with: node generate_icons.js
// Requires: npm install canvas
// Or just use any 16x16, 48x48, 128x128 PNG images named icon16.png etc.

const { createCanvas } = require('canvas');
const fs = require('fs');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size;

  // Background circle
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#1a73e8';
  ctx.fill();

  // Gamepad body
  ctx.fillStyle = '#ffffff';
  const bw = s * 0.7, bh = s * 0.4;
  const bx = (s - bw) / 2, by = (s - bh) / 2;
  const r = bh * 0.35;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, r);
  ctx.fill();

  // D-pad dot (left)
  ctx.fillStyle = '#1a73e8';
  ctx.beginPath();
  ctx.arc(s * 0.3, s * 0.5, s * 0.06, 0, Math.PI * 2);
  ctx.fill();

  // Button dot (right)
  ctx.beginPath();
  ctx.arc(s * 0.7, s * 0.5, s * 0.06, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toBuffer('image/png');
}

for (const size of [16, 48, 128]) {
  fs.writeFileSync(`icon${size}.png`, drawIcon(size));
  console.log(`Generated icon${size}.png`);
}
