import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const require = createRequire(import.meta.url);
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { discoverSync } = require('../../src/main/discovery/discover.js');
const { PACKAGE_EXTENSIONS, isPackageName } = require('../../src/main/discovery/packages.js');
const readonlyCheck = require('../../tools/readonly-check/index.js');

let root;
let manifest;
let records;
let before;
let after;

beforeAll(async () => {
  ({ root, manifest } = buildFixtureTree());
  // Extra packages, each holding a supported file (fixture only has two).
  for (const dir of ['X.photoslibrary', 'Y.bundle', 'Z.framework', 'W.rtfd', 'V.APP']) {
    fs.mkdirSync(path.join(root, 'pk', dir, 'in'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pk', dir, 'in', 'p.jpg'), 'x');
  }
  fs.writeFileSync(path.join(root, 'pk', 'ok.jpg'), 'x');
  before = readonlyCheck.snapshot(root, { role: 'before' });
  records = discoverSync(root);
  after = readonlyCheck.snapshot(root, { role: 'after' });
});

afterAll(() => {
  if (root) cleanupFixtureTree(root);
});

const rels = () => records.map((r) => r.relativePath);

describe('discovery', () => {
  it('indexes every visible supported fixture file and nothing else of the fixture', () => {
    const expected = manifest.supportedFiles
      .filter((r) => !r.split('/').some((p) => p.startsWith('.')))
      .filter((r) => !/\.(app|photoslibrary)\//.test(r));
    expect(rels().filter((r) => !r.startsWith('pk/'))).toEqual([...expected].sort());
  });

  it('indexes supported files at depth 4+ and uppercase extensions', () => {
    expect(rels()).toContain('Photos/2024/Trip/Day1/deep.jpg');
    const upper = records.find((r) => r.relativePath === 'Photos/A.JPG');
    expect(upper).toMatchObject({ name: 'A.JPG', extension: 'jpg', kind: 'image' });
  });

  it('does not index unsupported extensions', () => {
    expect(manifest.unsupportedFiles).toContain('Docs/readme.md');
    expect(manifest.unsupportedFiles).toContain('Docs/data.xyz');
    for (const r of manifest.unsupportedFiles) expect(rels()).not.toContain(r);
  });

  it('skips dot-named files and folders with their contents', () => {
    expect(rels().filter((r) => r.split('/').some((p) => p.startsWith('.')))).toEqual([]);
    expect(rels()).not.toContain('.hiddenDir/inside.jpg');
  });

  it('does not index package contents for all package extensions', () => {
    expect(rels().filter((r) => /\.(app|photoslibrary|bundle|framework|rtfd)\//i.test(r))).toEqual([]);
    expect(rels().filter((r) => r.startsWith('pk/'))).toEqual(['pk/ok.jpg']);
  });

  it('keeps the package extension list as one named export', () => {
    expect([...PACKAGE_EXTENSIONS].sort()).toEqual(['.app', '.bundle', '.framework', '.photoslibrary', '.rtfd']);
    expect(isPackageName('Thing.app')).toBe(true);
    expect(isPackageName('Thing.APP')).toBe(true);
    expect(isPackageName('Photos')).toBe(false);
  });

  it('neither follows symlinks to folders nor indexes symlinks to files', () => {
    expect(rels().filter((r) => r.startsWith('link-to-folder'))).toEqual([]);
    expect(rels()).not.toContain('link-to-file');
    expect(manifest.symlinks.map((s) => s.targetKind).sort()).toEqual(['file', 'folder']);
  });

  it('returns records with absolute path, "/" relativePath, kind and subtype', () => {
    for (const r of records) {
      expect(path.isAbsolute(r.path)).toBe(true);
      expect(r.path).toBe(path.join(root, ...r.relativePath.split('/')));
      expect(r.extension).toBe(r.extension.toLowerCase());
    }
    const flac = records.find((r) => r.name === 'track01.flac');
    expect(flac).toMatchObject({ kind: 'audio', extension: 'flac' });
    expect(flac).not.toHaveProperty('subtype');
  });

  it('is sorted by relativePath and deterministic', () => {
    expect(rels()).toEqual([...rels()].sort());
    expect(discoverSync(root)).toEqual(discoverSync(root));
  });

  it('adds subtype for RAW files', () => {
    const dir = fs.mkdtempSync(path.join(root, 'raw-'));
    fs.writeFileSync(path.join(dir, 'a.CR2'), 'x');
    const [rec] = discoverSync(dir);
    expect(rec).toMatchObject({ kind: 'image', subtype: 'RAW', extension: 'cr2' });
    fs.rmSync(dir, { recursive: true });
  });

  it('skips unreadable subdirectories and reports them via onError', () => {
    const dir = fs.mkdtempSync(path.join(root, 'unread-'));
    fs.mkdirSync(path.join(dir, 'locked'));
    fs.writeFileSync(path.join(dir, 'locked', 'h.jpg'), 'x');
    fs.writeFileSync(path.join(dir, 'ok.jpg'), 'x');
    fs.chmodSync(path.join(dir, 'locked'), 0o000);
    try {
      const errors = [];
      const out = discoverSync(dir, { onError: (e, p) => errors.push(p) });
      expect(out.map((r) => r.relativePath)).toEqual(['ok.jpg']);
      expect(errors).toEqual([path.join(dir, 'locked')]);
    } finally {
      fs.chmodSync(path.join(dir, 'locked'), 0o755);
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('throws for an unreadable or relative root', () => {
    expect(() => discoverSync(path.join(root, 'nope'))).toThrow();
    expect(() => discoverSync('relative/dir')).toThrow(TypeError);
  });

  it('exports discoverSync only (no unused async discover walk)', () => {
    const exported = require('../../src/main/discovery/discover.js');
    expect(exported).not.toHaveProperty('discover');
    expect(typeof exported.discoverSync).toBe('function');
  });

  it('leaves the scanned tree unchanged (read-only check)', () => {
    expect(() => readonlyCheck.assert(before, after)).not.toThrow();
  });
});
