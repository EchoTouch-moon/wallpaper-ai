#!/usr/bin/env node
/**
 * Generate solid-color test PNGs for wallpaper-host P2.2 swap verification.
 *
 * Usage: node scripts/gen-test-assets.mjs [outDir] [count]
 * Default: .local/test-assets, 6 images. Distinct hues so a slot swap is
 * unambiguous in a screenshot. Output dir is gitignored (.local/).
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? ".local/test-assets");
const count = Number.parseInt(process.argv[3] ?? "6", 10);

// CRC32 (PNG requirement)
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = r;
    row[1 + x * 3 + 1] = g;
    row[1 + x * 3 + 2] = b;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Distinct hues; enough contrast that a swap is obvious in a screenshot.
const COLORS = [
  [220, 38, 38], // red
  [13, 148, 136], // teal
  [245, 158, 11], // amber
  [124, 58, 237], // violet
  [101, 163, 13], // lime
  [30, 64, 175], // blue
  [219, 39, 119], // pink
  [15, 23, 42], // slate
];

mkdirSync(outDir, { recursive: true });
for (let i = 0; i < count; i++) {
  const color = COLORS[i % COLORS.length];
  // Alternate portrait/landscape so center-crop behavior is visible too.
  const [w, h] = i % 2 === 0 ? [800, 1000] : [1200, 700];
  const file = `img-${String(i + 1).padStart(2, "0")}.png`;
  writeFileSync(join(outDir, file), png(w, h, color));
  console.log(`${file}  ${w}x${h}  rgb(${color.join(",")})`);
}
console.log(`\n${count} test image(s) in ${outDir}`);
