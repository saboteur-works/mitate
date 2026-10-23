#!/usr/bin/env node
'use strict';

/*
 * Builds a local sample library of real, decodable PNG images for trying the
 * app by hand with a large collection. Not product code; runs under plain Node.
 *
 * Usage: node tools/sample-library/generate.js [--count 10000] [--dir <path>]
 *
 * Default dir is <repo>/sample-library, which .gitignore excludes. Images are
 * 64x48 PNGs, each a horizontal gradient of its own hue, named photo1.png ...
 * photoN.png and spread over year/month folders (2019..2025 / 01..12), so the
 * Images list mixes folders and the tree has some depth.
 *
 * A marker file records that this script made the directory. A rerun removes
 * and rebuilds a directory carrying the marker, and refuses any other existing
 * directory, so it never deletes something it did not create.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const MARKER = '.mitate-sample-library';
const WIDTH = 64;
const HEIGHT = 48;
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

function parseArgs(argv) {
  const out = { count: 10000, dir: path.join(ROOT, 'sample-library') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--count') out.count = Number(argv[++i]);
    else if (argv[i] === '--dir') out.dir = path.resolve(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(out.count) || out.count < 1) throw new Error('--count must be a positive integer');
  return out;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

// hue in [0, 360). RGB from HSV with full saturation; value ramps left to right.
function rgb(hue, value) {
  const c = value;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round(v * 255));
}

function png(hue) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour RGB
  const row = Buffer.alloc(1 + WIDTH * 3); // leading 0 = filter type None
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = rgb(hue, 0.35 + (0.65 * x) / (WIDTH - 1));
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: HEIGHT }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function prepare(dir) {
  if (fs.existsSync(dir)) {
    if (!fs.existsSync(path.join(dir, MARKER))) {
      throw new Error(`refusing to replace ${dir}: it exists and was not made by this script`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER), 'created by tools/sample-library/generate.js\n');
}

function main() {
  const { count, dir } = parseArgs(process.argv.slice(2));
  prepare(dir);
  const started = Date.now();
  const months = YEARS.length * 12;
  for (let i = 0; i < count; i += 1) {
    const m = i % months;
    const folder = path.join(dir, String(YEARS[Math.floor(m / 12)]), String((m % 12) + 1).padStart(2, '0'));
    if (i < months) fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `photo${i + 1}.png`), png((i * 137.5) % 360));
  }
  console.log(`${count} images in ${dir} (${Date.now() - started} ms)`);
}

main();
