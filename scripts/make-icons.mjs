/**
 * Generates the PWA icons procedurally.
 *
 * There is no image editor in this toolchain, and adding one (sharp, canvas)
 * for two flat-colour icons is not worth the dependency. A PNG is just a
 * zlib-compressed bitmap wrapped in length-prefixed chunks, so we can write one
 * directly. Re-runnable: `node scripts/make-icons.mjs`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BG = [15, 23, 42]; // slate-900, matches BRANDING.backgroundColor
const FG = [56, 189, 248]; // sky-400

/** Bar heights as a fraction of the icon, forming a stylised sound wave. */
const BARS = [0.34, 0.62, 0.9, 0.62, 0.34];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixelAt) {
  // Each row is prefixed with a filter byte; 0 means "store raw".
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makePixelFn(size) {
  const barWidth = size * 0.086;
  const gap = size * 0.048;
  const totalWidth = BARS.length * barWidth + (BARS.length - 1) * gap;
  const startX = (size - totalWidth) / 2;
  const radius = barWidth / 2;

  return (x, y) => {
    for (let i = 0; i < BARS.length; i++) {
      const x0 = startX + i * (barWidth + gap);
      const x1 = x0 + barWidth;
      const height = size * BARS[i];
      const y0 = (size - height) / 2;
      const y1 = y0 + height;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;

      // Round the bar caps so the icon does not look like a bar chart.
      const cx = Math.min(Math.max(x + 0.5, x0 + radius), x1 - radius);
      const cy = Math.min(Math.max(y + 0.5, y0 + radius), y1 - radius);
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= radius * radius) return FG;
    }
    return BG;
  };
}

mkdirSync(OUT_DIR, { recursive: true });

for (const size of [192, 512]) {
  const png = encodePng(size, makePixelFn(size));
  writeFileSync(join(OUT_DIR, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}

// The favicon is the same mark, but vector so it stays crisp in a browser tab.
const bars = BARS.map((h, i) => {
  const barWidth = 8.6;
  const gap = 4.8;
  const total = BARS.length * barWidth + (BARS.length - 1) * gap;
  const x = (100 - total) / 2 + i * (barWidth + gap);
  const height = 100 * h;
  return `<rect x="${x.toFixed(2)}" y="${((100 - height) / 2).toFixed(2)}" width="${barWidth}" height="${height.toFixed(2)}" rx="${(barWidth / 2).toFixed(2)}" fill="rgb(${FG})"/>`;
}).join('');

writeFileSync(
  join(OUT_DIR, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="rgb(${BG})"/>${bars}</svg>\n`,
);
console.log('wrote favicon.svg');
