import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import fixture from '../support/fixture-tree.js';

const { buildFixtureTree, cleanupFixtureTree } = fixture;

describe('fixture tree builder', () => {
  let root;
  let manifest;

  beforeAll(() => {
    ({ root, manifest } = buildFixtureTree());
  });

  afterAll(() => {
    if (root) cleanupFixtureTree(root);
  });

  it('builds inside the temp directory', () => {
    expect(root.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
    expect(fs.statSync(root).isDirectory()).toBe(true);
  });

  it('has a supported file at depth >= 4 that exists on disk', () => {
    expect(manifest.maxDepth).toBeGreaterThanOrEqual(4);
    const deep = manifest.supportedFiles.filter((r) => r.split('/').length >= 4);
    expect(deep.length).toBeGreaterThan(0);
    for (const r of deep) expect(fs.statSync(path.join(root, r)).isFile()).toBe(true);
  });

  it('has supported and unsupported files', () => {
    expect(manifest.supportedFiles.length).toBeGreaterThan(0);
    expect(manifest.unsupportedFiles.length).toBeGreaterThan(0);
    for (const r of [...manifest.supportedFiles, ...manifest.unsupportedFiles]) {
      expect(fs.lstatSync(path.join(root, r)).isFile()).toBe(true);
    }
  });

  it('has an uppercase-extension file', () => {
    expect(fs.readdirSync(path.join(root, 'Photos'))).toContain('A.JPG');
  });

  it('has a dot-file and a dot-folder', () => {
    expect(fs.lstatSync(path.join(root, '.hidden.jpg')).isFile()).toBe(true);
    expect(fs.lstatSync(path.join(root, '.hiddenDir')).isDirectory()).toBe(true);
    expect(manifest.hiddenFiles).toContain('.hidden.jpg');
    expect(manifest.hiddenDirs).toContain('.hiddenDir');
  });

  it('has a .app package directory with contents', () => {
    const app = path.join(root, 'Thing.app');
    expect(fs.lstatSync(app).isDirectory()).toBe(true);
    expect(manifest.packageDirs).toContain('Thing.app/Contents/Resources');
    expect(fs.existsSync(path.join(app, 'Contents/Resources/icon.png'))).toBe(true);
  });

  it('has a symlink to a folder and a symlink to a file', () => {
    const byKind = (k) => manifest.symlinks.find((s) => s.targetKind === k);
    const dirLink = byKind('folder');
    const fileLink = byKind('file');
    expect(fs.lstatSync(dirLink.path).isSymbolicLink()).toBe(true);
    expect(fs.statSync(dirLink.path).isDirectory()).toBe(true);
    expect(fs.lstatSync(fileLink.path).isSymbolicLink()).toBe(true);
    expect(fs.statSync(fileLink.path).isFile()).toBe(true);
  });

  it('has files with extended attributes that read back', () => {
    const onFiles = manifest.xattrs.filter((x) => fs.lstatSync(x.path).isFile());
    expect(onFiles.length).toBeGreaterThan(0);
    for (const x of manifest.xattrs) {
      const value = execFileSync('xattr', ['-p', x.name, x.path]).toString().trim();
      expect(value).toBe(x.value);
    }
  });

  it('cleanup removes the tree, is idempotent, and refuses non-fixture paths', () => {
    const built = buildFixtureTree();
    expect(fs.existsSync(built.root)).toBe(true);
    cleanupFixtureTree(built.root);
    expect(fs.existsSync(built.root)).toBe(false);
    expect(() => cleanupFixtureTree(built.root)).not.toThrow();
    expect(() => cleanupFixtureTree(os.tmpdir())).toThrow(/refusing/);
  });
});
