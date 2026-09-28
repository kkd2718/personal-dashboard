// Regenerates every raster icon from app/icon.svg (the single source):
//   app/favicon.ico            16/32/48 px, PNG-in-ICO
//   app/apple-icon.png         180 px, full-bleed (iOS applies its own corner mask)
//   public/icons/icon-192.png  rounded, manifest purpose "any"
//   public/icons/icon-512.png  rounded, manifest purpose "any"
//   public/icons/maskable-512.png  full-bleed, manifest purpose "maskable"
// Run: node scripts/build-icons.mjs  (uses the sharp copy Next already installs)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(ROOT, 'package.json'))('sharp');

const rounded = readFileSync(path.join(ROOT, 'app', 'icon.svg'), 'utf-8');
// Full-bleed variant: same artwork, square background. The panels sit inside the
// central 56%, well within the maskable safe zone (80% circle).
const fullBleed = rounded.replace('rx="112"', 'rx="0"');

async function png(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();
}

/** Minimal ICO container holding PNG images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

mkdirSync(path.join(ROOT, 'public', 'icons'), { recursive: true });
const icoImages = [];
for (const size of [16, 32, 48]) icoImages.push({ size, data: await png(rounded, size) });
writeFileSync(path.join(ROOT, 'app', 'favicon.ico'), ico(icoImages));
writeFileSync(path.join(ROOT, 'app', 'apple-icon.png'), await png(fullBleed, 180));
writeFileSync(path.join(ROOT, 'public', 'icons', 'icon-192.png'), await png(rounded, 192));
writeFileSync(path.join(ROOT, 'public', 'icons', 'icon-512.png'), await png(rounded, 512));
writeFileSync(path.join(ROOT, 'public', 'icons', 'maskable-512.png'), await png(fullBleed, 512));
console.log('icons written');
