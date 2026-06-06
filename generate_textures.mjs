// Run once: node generate_textures.mjs
// Generates 4× template PNGs in textures/ for each puppet body part.
// Red/colored dots = joint connection points. Replace PNGs with your artwork.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

mkdirSync('./textures', { recursive: true });

const S = 4; // scale multiplier

// Joint positions are in body-local pixels (origin = body center).
// Colours match connection type so you can see which parts link together.
const PARTS = [
  {
    name: 'head', w: 55, h: 60,
    joints: [{ x: 0, y: 30, c: '#e05050', lbl: 'neck ↓' }],
  },
  {
    name: 'chest', w: 70, h: 72,
    joints: [
      { x:   0, y: -36, c: '#e05050', lbl: 'neck ↑'       },
      { x:   0, y:  36, c: '#4499dd', lbl: 'waist ↓'      },
      { x: -35, y: -21, c: '#44bb44', lbl: 'L shoulder ←' },
      { x:  35, y: -21, c: '#44bb44', lbl: 'R shoulder →' },
    ],
  },
  {
    name: 'midTorso', w: 65, h: 55,
    joints: [
      { x: 0, y: -27.5, c: '#4499dd', lbl: 'waist ↑'   },
      { x: 0, y:  27.5, c: '#4499dd', lbl: 'waist ↓'   },
    ],
  },
  {
    name: 'pelvis', w: 68, h: 60,
    joints: [
      { x:   0, y: -30, c: '#4499dd', lbl: 'waist ↑' },
      { x: -16, y:  30, c: '#ddaa22', lbl: 'L hip ←' },
      { x:  16, y:  30, c: '#ddaa22', lbl: 'R hip →' },
    ],
  },
  {
    name: 'upperArmL', w: 28, h: 100,
    joints: [
      { x: 0, y: -50, c: '#44bb44', lbl: 'shoulder ↑' },
      { x: 0, y:  50, c: '#bb44bb', lbl: 'elbow ↓'    },
    ],
  },
  {
    name: 'upperArmR', w: 28, h: 100,
    joints: [
      { x: 0, y: -50, c: '#44bb44', lbl: 'shoulder ↑' },
      { x: 0, y:  50, c: '#bb44bb', lbl: 'elbow ↓'    },
    ],
  },
  {
    name: 'lowerArmL', w: 22, h: 85,
    joints: [
      { x: 0, y: -42.5, c: '#bb44bb', lbl: 'elbow ↑' },
      { x: 0, y:  42.5, c: '#aaaaaa', lbl: 'wrist ↓' },
    ],
  },
  {
    name: 'lowerArmR', w: 22, h: 85,
    joints: [
      { x: 0, y: -42.5, c: '#bb44bb', lbl: 'elbow ↑' },
      { x: 0, y:  42.5, c: '#aaaaaa', lbl: 'wrist ↓' },
    ],
  },
  {
    name: 'upperLegL', w: 32, h: 115,
    joints: [
      { x: 0, y: -57.5, c: '#ddaa22', lbl: 'hip ↑'  },
      { x: 0, y:  57.5, c: '#22aadd', lbl: 'knee ↓' },
    ],
  },
  {
    name: 'upperLegR', w: 32, h: 115,
    joints: [
      { x: 0, y: -57.5, c: '#ddaa22', lbl: 'hip ↑'  },
      { x: 0, y:  57.5, c: '#22aadd', lbl: 'knee ↓' },
    ],
  },
  {
    name: 'lowerLegL', w: 28, h: 100,
    joints: [
      { x: 0, y: -50, c: '#22aadd', lbl: 'knee ↑'  },
      { x: 0, y:  50, c: '#aaaaaa', lbl: 'ankle ↓' },
    ],
  },
  {
    name: 'lowerLegR', w: 28, h: 100,
    joints: [
      { x: 0, y: -50, c: '#22aadd', lbl: 'knee ↑'  },
      { x: 0, y:  50, c: '#aaaaaa', lbl: 'ankle ↓' },
    ],
  },
];

const browser = await chromium.launch();
const page    = await browser.newPage();

for (const part of PARTS) {
  const W = part.w * S, H = part.h * S;
  await page.setViewportSize({ width: W + 2, height: H + 2 });
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#fff">
    <canvas id="c" width="${W}" height="${H}"></canvas></body></html>`);

  await page.evaluate(({ W, H, S, part }) => {
    const ctx = document.getElementById('c').getContext('2d');

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Shape area fill
    ctx.fillStyle = 'rgba(190, 215, 235, 0.35)';
    ctx.fillRect(0, 0, W, H);

    // Grid (8px at 1× = 32px at 4×)
    ctx.strokeStyle = 'rgba(150, 190, 220, 0.25)';
    ctx.lineWidth = 1;
    const grid = 8 * S;
    for (let x = grid; x < W; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = grid; y < H; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Centre crosshair
    ctx.strokeStyle = 'rgba(100, 150, 200, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bounding-box border
    ctx.strokeStyle = '#7aabcc';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // Joint dots + labels
    for (const j of part.joints) {
      const jx = W / 2 + j.x * S;
      const jy = H / 2 + j.y * S;
      ctx.beginPath();
      ctx.arc(jx, jy, 7, 0, Math.PI * 2);
      ctx.fillStyle = j.c;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = j.c;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(j.lbl, jx + 10, jy + 4);
    }

    // Part name + size
    ctx.fillStyle = 'rgba(40, 80, 120, 0.7)';
    ctx.font = `bold ${13}px monospace`;
    ctx.fillText(part.name, 6, 17);
    ctx.font = `${11}px monospace`;
    ctx.fillText(`${part.w} × ${part.h} px  (${S}× → ${W}×${H})`, 6, 31);
  }, { W, H, S, part });

  const dataUrl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
  const buf = Buffer.from(dataUrl.replace('data:image/png;base64,', ''), 'base64');
  writeFileSync(`./textures/${part.name}.png`, buf);
  console.log(`✓ textures/${part.name}.png  (${W}×${H})`);
}

await browser.close();
console.log('\nDone. Replace the PNGs in textures/ with your artwork.');
