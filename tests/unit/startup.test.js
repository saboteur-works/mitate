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
  expect(reportError.mock.calls[0][0]).toContain(storeFile);
  expect(fs.readFileSync(storeFile).equals(before)).toBe(true);
  expect(fs.readdirSync(baseDir).sort()).toEqual(filesBefore);
}

describe('startStorage', () => {
  it('reports a store.json with invalid JSON and leaves it untouched', async () => {
    await expectReportedAndUntouched('{ this is not json');
  });

  it('reports a store.json with a version above the supported one and leaves it untouched', async () => {
    await expectReportedAndUntouched(
      JSON.stringify({ version: 999, collections: {}, folders: {}, index: {}, access: {} })
    );
  });

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
