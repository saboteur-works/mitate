import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fixture from '../support/fixture-tree.js';
import check from '../../tools/readonly-check/index.js';

const { buildFixtureTree, cleanupFixtureTree } = fixture;
const { snapshot, compare, assert } = check;

const FILE = 'Photos/2024/b.png';
const XATTR_FILE = 'Photos/A.JPG';
const XATTR_NAME = 'com.mediaorganizer.fixture';
const XATTR_NAME_RE = 'xattr:com\\.mediaorganizer\\.fixture';

describe('read-only check', () => {
  let root;
  let before;

  const abs = (rel) => path.join(root, rel);
  const changedFields = (diff, rel) => {
    const entry = diff.changed.find((c) => c.path === rel);
    return entry ? entry.fields : [];
  };

  beforeEach(() => {
    ({ root } = buildFixtureTree());
    before = snapshot(root, { role: 'before' });
  });

  afterEach(() => {
    cleanupFixtureTree(root);
  });

  it('reports no differences, including access time, for two snapshots with nothing in between', () => {
    const after = snapshot(root, { role: 'after' });
    const diff = compare(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.atime).toEqual([]);
    expect(() => assert(before, after, { failOnAtime: true })).not.toThrow();
  });

  it('detects a byte changed with the size unchanged and names contentHash', () => {
    const original = fs.readFileSync(abs(FILE));
    const modified = Buffer.from(original);
    modified[0] = modified[0] ^ 0xff;
    fs.writeFileSync(abs(FILE), modified);
    expect(fs.statSync(abs(FILE)).size).toBe(original.length);

    const after = snapshot(root, { role: 'after' });
    const diff = compare(before, after);
    const fields = changedFields(diff, FILE);
    expect(fields).toContain('contentHash');
    expect(fields).not.toContain('size');
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(() => assert(before, after)).toThrow(/contentHash/);
  });

  it('detects a file created and names it as added', () => {
    fs.writeFileSync(abs('Docs/new-file.txt'), 'new');
    const after = snapshot(root, { role: 'after' });
    const diff = compare(before, after);
    expect(diff.added).toEqual(['Docs/new-file.txt']);
    expect(diff.removed).toEqual([]);
    expect(() => assert(before, after)).toThrow(/added: Docs\/new-file\.txt/);
  });

  it('detects a file deleted and names it as removed', () => {
    fs.rmSync(abs(FILE));
    const after = snapshot(root, { role: 'after' });
    const diff = compare(before, after);
    expect(diff.removed).toEqual([FILE]);
    expect(diff.added).toEqual([]);
    expect(() => assert(before, after)).toThrow(/removed: Photos\/2024\/b\.png/);
  });

  it('detects a file renamed as the old path removed and the new path added', () => {
    const renamed = 'Photos/2024/b-renamed.png';
    fs.renameSync(abs(FILE), abs(renamed));
    const after = snapshot(root, { role: 'after' });
    const diff = compare(before, after);
    expect(diff.removed).toEqual([FILE]);
    expect(diff.added).toEqual([renamed]);
    expect(() => assert(before, after)).toThrow(/removed: Photos\/2024\/b\.png/);
    expect(() => assert(before, after)).toThrow(/added: Photos\/2024\/b-renamed\.png/);
  });

  it('detects a modification time change and names mtimeNs', () => {
    const st = fs.statSync(abs(FILE));
    const newMtime = new Date(st.mtimeMs - 86400 * 1000);
    fs.utimesSync(abs(FILE), st.atime, newMtime);
    const after = snapshot(root, { role: 'after' });
    const diff = compare(before, after);
    const fields = changedFields(diff, FILE);
    expect(fields).toContain('mtimeNs');
    expect(fields).not.toContain('contentHash');
    expect(fields).not.toContain('size');
    expect(() => assert(before, after)).toThrow(/mtimeNs/);
  });

  it('detects an extended attribute added and names it', () => {
    execFileSync('xattr', ['-w', 'com.mediaorganizer.added', 'v', abs(FILE)]);
    const after = snapshot(root, { role: 'after' });
    const diff = compare(before, after);
    expect(changedFields(diff, FILE)).toContain('xattr:com.mediaorganizer.added');
    expect(() => assert(before, after)).toThrow(/xattr:com\.mediaorganizer\.added/);
  });

  it('detects an extended attribute value change and names it', () => {
    execFileSync('xattr', ['-w', XATTR_NAME, 'changed-value', abs(XATTR_FILE)]);
    const after = snapshot(root, { role: 'after' });
    const diff = compare(before, after);
    const fields = changedFields(diff, XATTR_FILE);
    expect(fields).toContain(`xattr:${XATTR_NAME}`);
    expect(fields).not.toContain('contentHash');
    expect(() => assert(before, after)).toThrow(new RegExp(XATTR_NAME_RE));
  });

  it('detects an extended attribute removed and names it', () => {
    execFileSync('xattr', ['-d', XATTR_NAME, abs(XATTR_FILE)]);
    const after = snapshot(root, { role: 'after' });
    const diff = compare(before, after);
    expect(changedFields(diff, XATTR_FILE)).toContain(`xattr:${XATTR_NAME}`);
    expect(() => assert(before, after)).toThrow(new RegExp(XATTR_NAME_RE));
  });

  it('reports an atime-only difference separately; throws only with failOnAtime', () => {
    const after = snapshot(root, { role: 'after' });
    const altered = structuredClone(after);
    altered.entries[FILE].atimeNs = (BigInt(altered.entries[FILE].atimeNs) + 5_000_000_000n).toString();

    const diff = compare(before, altered);
    expect(diff.atime.map((t) => t.path)).toEqual([FILE]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);

    let result;
    expect(() => { result = assert(before, altered); }).not.toThrow();
    expect(result.atime.map((t) => t.path)).toEqual([FILE]);
    expect(() => assert(before, altered, { failOnAtime: true })).toThrow(/atime: Photos\/2024\/b\.png/);
  });
});
