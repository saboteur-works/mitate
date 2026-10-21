import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fixture from '../support/large-fixture.js';

const { buildLargeFixture, cleanupLargeFixture } = fixture;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name !== '.mo-large-fixture') out.push(p);
  }
  return out;
}

const made = [];
const build = (opts) => {
  const f = buildLargeFixture(opts);
  made.push(f.root);
  return f;
};

afterAll(() => {
  for (const r of made) cleanupLargeFixture(r);
});

describe('large fixture generator', () => {
  const { root, counts } = build({ files: 10000 });
  const files = walk(root);

  it('creates the requested number of files, all kinds present', () => {
    expect(files).toHaveLength(10000);
    expect(counts.image + counts.audio + counts.video + counts.document).toBe(10000);
    for (const k of Object.keys(counts)) expect(counts[k]).toBeGreaterThan(0);
  });

  it('builds inside the temp directory', () => {
    expect(root.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
  });

  it('spreads files over at least 20 directories at depth 2 or more', () => {
    const dirs = new Set(files.map((f) => path.dirname(f)));
    const deep = [...dirs].filter((d) => path.relative(root, d).split(path.sep).length >= 2);
    expect(deep.length).toBeGreaterThanOrEqual(20);
  });

  it('uses numbered names for natural order', () => {
    const names = new Set(files.map((f) => path.basename(f)));
    const stems = [...names].map((n) => n.replace(/\.[^.]+$/, ''));
    for (const s of ['img1', 'img2', 'img10']) expect(stems).toContain(s);
  });

  it('includes RAW, uppercase and txt extensions', () => {
    const exts = new Set(files.map((f) => path.extname(f)));
    expect(exts.has('.cr2')).toBe(true);
    expect(exts.has('.JPG')).toBe(true);
    expect(exts.has('.txt')).toBe(true);
  });

  it('gives a different root on a second call', () => {
    expect(build({ files: 4 }).root).not.toBe(root);
  });

  it('returns an empty root for files: 0', () => {
    const r = build({ files: 0 });
    expect(walk(r.root)).toEqual([]);
    expect(r.counts).toEqual({ image: 0, audio: 0, video: 0, document: 0 });
  });

  it('rejects a bad file count', () => {
    expect(() => buildLargeFixture({ files: -1 })).toThrow();
  });
});

describe('cleanupLargeFixture', () => {
  it('removes a tree it created, and is safe twice', () => {
    const { root } = build({ files: 8 });
    cleanupLargeFixture(root);
    expect(fs.existsSync(root)).toBe(false);
    expect(() => cleanupLargeFixture(root)).not.toThrow();
  });

  it('refuses paths it did not create', () => {
    expect(() => cleanupLargeFixture(os.tmpdir())).toThrow(/refusing/);
    expect(() => cleanupLargeFixture('/')).toThrow(/refusing/);
    expect(() => cleanupLargeFixture('')).toThrow(/refusing/);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-large-fixture-'));
    try {
      expect(() => cleanupLargeFixture(plain)).toThrow(/refusing/); // no marker
      expect(fs.existsSync(plain)).toBe(true);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
