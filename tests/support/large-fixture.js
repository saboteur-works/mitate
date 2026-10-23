'use strict';
/*
 * Large fixture generator for the type-view e2e tests. CommonJS so Vitest,
 * Playwright and the Electron main process can all require it.
 *
 * API
 *   buildLargeFixture({ files }) -> { root, counts }
 *     Creates a fresh directory under os.tmpdir() holding `files` empty
 *     supported files spread over the four kinds and over nested directories
 *     (35 directories at depth 2, files at depth 3). A marker file records
 *     that this module made the directory.
 *     root:   absolute, realpath-resolved path.
 *     counts: { image, audio, video, document } number of files of each kind.
 *     Names carry numbers (img1, img2, img10, ...) for natural-order checks.
 *     Extensions include RAW (.cr2), uppercase (.JPG) and .txt.
 *   cleanupLargeFixture(root) -> removes the tree. It refuses a path that is
 *     not a directory directly under the temp dir with this module's prefix
 *     and marker file.
 *
 * Files are empty; the scanner only needs names and extensions. Nothing
 * outside root is touched.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PREFIX = 'mo-large-fixture-';
const MARKER = '.mo-large-fixture';

// One entry per kind: name stem and the extensions it cycles through.
const KINDS = [
  { kind: 'image', stem: 'img', exts: ['jpg', 'JPG', 'png', 'cr2'] },
  { kind: 'audio', stem: 'track', exts: ['mp3', 'flac'] },
  { kind: 'video', stem: 'clip', exts: ['mp4', 'mov'] },
  { kind: 'document', stem: 'doc', exts: ['pdf', 'txt'] },
];
const TOP_DIRS = 5;
const SUB_DIRS = 7;

function buildLargeFixture({ files } = {}) {
  if (!Number.isInteger(files) || files < 0) {
    throw new Error('buildLargeFixture: files must be a non-negative integer');
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
  const counts = { image: 0, audio: 0, video: 0, document: 0 };
  try {
    fs.writeFileSync(path.join(root, MARKER), 'created by tests/support/large-fixture.js\n');
    for (let t = 0; t < TOP_DIRS; t++) {
      for (let s = 0; s < SUB_DIRS; s++) fs.mkdirSync(path.join(root, `album${t}`, `set${s}`), { recursive: true });
    }
    for (let i = 0; i < files; i++) {
      const k = KINDS[i % KINDS.length];
      const n = Math.floor(i / KINDS.length) + 1;
      const ext = k.exts[n % k.exts.length];
      const dir = path.join(root, `album${i % TOP_DIRS}`, `set${i % SUB_DIRS}`);
      fs.writeFileSync(path.join(dir, `${k.stem}${n}.${ext}`), '');
      counts[k.kind]++;
    }
  } catch (err) {
    cleanupLargeFixture(root);
    throw err;
  }
  return { root, counts };
}

function cleanupLargeFixture(root) {
  if (typeof root !== 'string' || root === '') {
    throw new Error(`refusing to remove non-fixture directory: ${root}`);
  }
  const resolved = path.resolve(root);
  const tmp = fs.realpathSync(os.tmpdir());
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch (err) {
    if (err.code === 'ENOENT') return; // already removed
    throw err;
  }
  const ok =
    path.dirname(real) === tmp &&
    path.basename(real).startsWith(PREFIX) &&
    fs.statSync(real).isDirectory() &&
    fs.existsSync(path.join(real, MARKER));
  if (!ok) throw new Error(`refusing to remove non-fixture directory: ${root}`);
  fs.rmSync(real, { recursive: true, force: true });
}

module.exports = { buildLargeFixture, cleanupLargeFixture };
