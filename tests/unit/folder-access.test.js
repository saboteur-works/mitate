import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { checkReadableDirectory, isReadableDirectory, scanFolder } = require('../../src/main/collections/folder-access.js');

let work;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-access-'));
});
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe('checkReadableDirectory', () => {
  it('returns null for a readable directory', async () => {
    expect(await checkReadableDirectory(work)).toBeNull();
    expect(await isReadableDirectory(work)).toBe(true);
  });

  it('names a missing folder and its error code', async () => {
    const missing = path.join(work, 'missing');
    expect(await checkReadableDirectory(missing)).toEqual({
      code: 'ENOENT',
      message: `Folder does not exist or cannot be read: ${missing} (ENOENT)`,
    });
    expect(await isReadableDirectory(missing)).toBe(false);
  });

  it('rejects a file as not a directory', async () => {
    const file = path.join(work, 'f.txt');
    fs.writeFileSync(file, 'x');
    expect((await checkReadableDirectory(file)).message).toBe(`Not a directory: ${file}`);
  });
});

describe('scanFolder', () => {
  it('returns the records of a scan that succeeds', async () => {
    expect(await scanFolder(async () => [{ name: 'a' }], work)).toEqual({ records: [{ name: 'a' }], unavailable: false });
  });

  it('turns a rejecting scan into an unavailable folder with no records', async () => {
    expect(await scanFolder(async () => { throw new Error('gone'); }, work)).toEqual({ records: [], unavailable: true });
  });
});
