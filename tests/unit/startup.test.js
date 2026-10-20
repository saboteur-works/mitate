import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { openStorage } = require('../../src/main/storage/index.js');
const { startStorage } = require('../../src/main/startup.js');


let baseDir;
let storeFile;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-test-'));
  storeFile = path.join(baseDir, 'store.json');
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

async function expectReportedAndUntouched(content) {
  fs.writeFileSync(storeFile, content);
  const before = fs.readFileSync(storeFile);
  const filesBefore = fs.readdirSync(baseDir).sort();
  const reportError = vi.fn();

  const result = await startStorage({ baseDir, openStorage, reportError });

  expect(result.ok).toBe(false);
  expect(result.storage).toBeUndefined();
  expect(reportError).toHaveBeenCalledTimes(1);
  const message = reportError.mock.calls[0][0];
  expect(message).toContain(storeFile);
  expect(message).toContain('The file has not been changed.');
  expect(fs.readFileSync(storeFile).equals(before)).toBe(true);
  expect(fs.readdirSync(baseDir).sort()).toEqual(filesBefore);
  return message;
}

describe('startStorage', () => {
  it('reports a store.json with invalid JSON as damaged and leaves it untouched', async () => {
    const message = await expectReportedAndUntouched('{ this is not json');
    expect(message).toMatch(/not valid JSON/);
    expect(message).toMatch(/backup/);
    expect(message).not.toMatch(/newer version/);
  });

  it('reports a store.json with a version above the supported one as newer and leaves it untouched', async () => {
    const message = await expectReportedAndUntouched(
      JSON.stringify({ version: 999, collections: {}, folders: {}, index: {}, access: {} })
    );
    expect(message).toMatch(/newer version of this app/);
    expect(message).toMatch(/format 999/);
    expect(message).not.toMatch(/corrupt|damaged/);
  });

  it('reports a store.json with a version below the supported one as older and leaves it untouched', async () => {
    const message = await expectReportedAndUntouched(
      JSON.stringify({ version: 0, collections: {}, folders: {}, index: {}, access: {} })
    );
    expect(message).toMatch(/older data format \(format 0\)/);
    expect(message).not.toMatch(/newer version|corrupt|damaged/);
  });

  it('reports a store.json without a usable version as unrecognized and leaves it untouched', async () => {
    const message = await expectReportedAndUntouched(JSON.stringify({ collections: {} }));
    expect(message).toMatch(/not in a format this app recognizes/);
    expect(message).not.toMatch(/newer version/);
  });

  // chmod 000 has no effect on root, so the unreadable-file case cannot run there.
  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'reports an unreadable (mode 000) store.json and leaves its bytes and mode untouched',
    async () => {
      fs.writeFileSync(
        storeFile,
        JSON.stringify({ version: 1, collections: {}, folders: {}, index: {}, access: {} }),
        { mode: 0o600 }
      );
      fs.chmodSync(storeFile, 0o600);
      const before = fs.readFileSync(storeFile);
      fs.chmodSync(storeFile, 0o000);
      try {
        const modeBefore = fs.statSync(storeFile).mode & 0o777;
        const filesBefore = fs.readdirSync(baseDir).sort();
        const reportError = vi.fn();

        const result = await startStorage({ baseDir, openStorage, reportError });

        expect(result.ok).toBe(false);
        expect(result.storage).toBeUndefined();
        expect(reportError).toHaveBeenCalledTimes(1);
        const message = reportError.mock.calls[0][0];
        expect(message).toContain(storeFile);
        expect(message).toMatch(/permission/i);
        expect(message).not.toMatch(/newer version|corrupt|damaged/);
        expect(message).toContain('The file has not been changed.');
        expect(fs.statSync(storeFile).mode & 0o777).toBe(modeBefore);
        expect(modeBefore).toBe(0o000);
        expect(fs.readdirSync(baseDir).sort()).toEqual(filesBefore);
        fs.chmodSync(storeFile, 0o600);
        expect(fs.readFileSync(storeFile).equals(before)).toBe(true);
      } finally {
        fs.chmodSync(storeFile, 0o600);
      }
    }
  );

  it('opens a valid store without reporting an error', async () => {
    fs.writeFileSync(
      storeFile,
      JSON.stringify({
        version: 1,
        collections: { c1: { id: 'c1', name: 'A', folderIds: [], createdAt: 'x' } },
        folders: {},
        index: {},
        access: {},
      })
    );
    const reportError = vi.fn();
    const result = await startStorage({ baseDir, openStorage, reportError });
    expect(result.ok).toBe(true);
    expect(result.storage.getCollection('c1').name).toBe('A');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('opens with no error on first run (missing store.json)', async () => {
    const reportError = vi.fn();
    const result = await startStorage({ baseDir, openStorage, reportError });
    expect(result.ok).toBe(true);
    expect(typeof result.storage.listCollections).toBe('function');
    expect(reportError).not.toHaveBeenCalled();
  });
});
