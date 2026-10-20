import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { registerIpc, CHANNELS } = require('../../src/main/ipc.js');

function setup({ dialogResult = { canceled: false, filePaths: ['/a', '/b'] }, service, rescanService, revealFile } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const calls = [];
  const dialog = {
    showOpenDialog: async (...args) => {
      calls.push(args);
      return dialogResult;
    },
  };
  const svc = service || {
    createCollection: async (name, dirs) => ({ collection: { id: `id-${name}`, name }, folders: dirs.map((d) => ({ path: d })), files: [] }),
    listCollectionSummaries: async () => [],
  };
  registerIpc({ ipcMain, dialog, service: svc, rescanService, revealFile });
  return { invoke: (ch, ...a) => handlers.get(ch)({}, ...a), calls };
}

describe('registerIpc', () => {
  it('opens the picker with directory-only properties and returns the paths', async () => {
    const { invoke, calls } = setup();
    const result = await invoke(CHANNELS.pickFolders);
    expect(result).toEqual({ canceled: false, paths: ['/a', '/b'] });
    const options = calls[0][calls[0].length - 1];
    expect(options.properties).toContain('openDirectory');
    expect(options.properties).not.toContain('openFile');
  });

  it('reports a canceled picker with no paths', async () => {
    const { invoke } = setup({ dialogResult: { canceled: true, filePaths: [] } });
    expect(await invoke(CHANNELS.pickFolders)).toEqual({ canceled: true, paths: [] });
  });

  it('delegates create and list to the service', async () => {
    const { invoke } = setup();
    const created = await invoke(CHANNELS.createCollection, 'N', ['/a']);
    expect(created.ok).toBe(true);
    expect(created.summary).toEqual({ id: 'id-N', name: 'N', folderCount: 1 });
    expect(await invoke(CHANNELS.listCollections)).toEqual({ ok: true, summaries: [] });
  });

  it('returns a collection view by id, or an error when unknown', async () => {
    const view = { collection: { id: 'c1' }, folders: [], files: [] };
    const service = { getCollectionView: (id) => (id === 'c1' ? view : null) };
    const { invoke } = setup({ service });
    expect(await invoke(CHANNELS.getCollectionView, 'c1')).toEqual({ ok: true, view });
    expect(await invoke(CHANNELS.getCollectionView, 'nope')).toEqual({ ok: false, error: 'Unknown collection: nope' });
  });

  it('returns service errors as { ok: false, error }', async () => {
    const service = {
      createCollection: async () => { throw new Error('bad name'); },
      listCollectionSummaries: async () => { throw new Error('boom'); },
    };
    const { invoke } = setup({ service });
    expect(await invoke(CHANNELS.createCollection, '', [])).toEqual({ ok: false, error: 'bad name' });
    expect(await invoke(CHANNELS.listCollections)).toEqual({ ok: false, error: 'boom' });
  });

  it('rescans a collection through the rescan service and splits view from summary', async () => {
    const summary = { rescanned: ['f1'], skipped: [] };
    const rescanService = {
      rescanCollection: async (id) => ({ collection: { id }, folders: [], files: [], summary }),
    };
    const { invoke } = setup({ rescanService });
    expect(await invoke(CHANNELS.rescanCollection, 'c1')).toEqual({
      ok: true,
      view: { collection: { id: 'c1' }, folders: [], files: [] },
      summary,
    });
  });

  it('returns rescan errors, and an error when no rescan service is wired', async () => {
    const failing = { rescanCollection: async () => { throw new Error('unknown collection: x'); } };
    expect(await setup({ rescanService: failing }).invoke(CHANNELS.rescanCollection, 'x')).toEqual({
      ok: false,
      error: 'unknown collection: x',
    });
    expect((await setup().invoke(CHANNELS.rescanCollection, 'x')).ok).toBe(false);
  });

  it('carries the error code of a concurrent-rescan rejection', async () => {
    const busy = {
      rescanCollection: async () => {
        throw Object.assign(new Error('already running'), { code: 'RESCAN_IN_PROGRESS' });
      },
    };
    expect(await setup({ rescanService: busy }).invoke(CHANNELS.rescanCollection, 'x')).toEqual({
      ok: false,
      error: 'already running',
      code: 'RESCAN_IN_PROGRESS',
    });
  });

  describe('files:reveal', () => {
    const indexed = '/Volumes/Media/a.jpg';
    const service = { findIndexedFile: (p) => (p === indexed ? { path: p } : null) };

    it('uses the channel name files:reveal', () => {
      expect(CHANNELS.revealFile).toBe('files:reveal');
    });

    it('reveals an indexed path once with that exact path', async () => {
      const revealFile = vi.fn(async () => {});
      expect(await setup({ service, revealFile }).invoke(CHANNELS.revealFile, indexed)).toEqual({ ok: true });
      expect(revealFile).toHaveBeenCalledTimes(1);
      expect(revealFile).toHaveBeenCalledWith(indexed);
    });

    it('rejects a path not in the index without calling revealFile', async () => {
      const revealFile = vi.fn(async () => {});
      const result = await setup({ service, revealFile }).invoke(CHANNELS.revealFile, '/etc/passwd');
      expect(result).toEqual({ ok: false, error: expect.any(String), code: 'NOT_INDEXED' });
      expect(revealFile).not.toHaveBeenCalled();
    });

    it('rejects non-string and empty arguments the same way', async () => {
      const revealFile = vi.fn(async () => {});
      const { invoke } = setup({ service, revealFile });
      for (const bad of [undefined, null, 42, {}, ['/Volumes/Media/a.jpg'], '']) {
        expect(await invoke(CHANNELS.revealFile, bad)).toEqual({ ok: false, error: expect.any(String), code: 'NOT_INDEXED' });
      }
      expect(revealFile).not.toHaveBeenCalled();
    });

    it('returns FILE_NOT_FOUND from revealFile with a message naming the path', async () => {
      const revealFile = async (p) => {
        throw Object.assign(new Error(`File not found: ${p}`), { code: 'FILE_NOT_FOUND' });
      };
      const result = await setup({ service, revealFile }).invoke(CHANNELS.revealFile, indexed);
      expect(result).toEqual({ ok: false, error: `File not found: ${indexed}`, code: 'FILE_NOT_FOUND' });
    });

    it('returns { ok: false, error } when no revealFile is injected', async () => {
      const result = await setup({ service }).invoke(CHANNELS.revealFile, indexed);
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe('string');
    });

    it('is exposed by the preload with the literal channel name', () => {
      const text = fs.readFileSync(new URL('../../src/main/preload.js', import.meta.url), 'utf8');
      expect(text).toMatch(/revealFile:\s*\(\w+\)\s*=>\s*ipcRenderer\.invoke\('files:reveal',/);
    });
  });
});
