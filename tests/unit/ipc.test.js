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

describe('collection management channels', () => {
  const view = { collection: { id: 'c1', name: 'New' }, folders: [{ id: 'f1' }, { id: 'f2' }], files: [] };
  const mk = (over = {}) => {
    const service = {
      renameCollection: vi.fn(async () => view),
      deleteCollection: vi.fn(async () => ({ deleted: true })),
      addFolder: vi.fn(async () => view),
      removeFolder: vi.fn(async () => view),
      createCollection: vi.fn(async () => ({ canceled: true })),
      ...over,
    };
    return { service, ...setup({ service }) };
  };

  it('names and registers the four channels', () => {
    expect(CHANNELS.renameCollection).toBe('collections:rename');
    expect(CHANNELS.deleteCollection).toBe('collections:delete');
    expect(CHANNELS.addFolder).toBe('collections:addFolder');
    expect(CHANNELS.removeFolder).toBe('collections:removeFolder');
  });

  it('rename returns the summary; add and remove return the view; delete returns deleted', async () => {
    const { service, invoke } = mk();
    expect(await invoke(CHANNELS.renameCollection, 'c1', 'New')).toEqual({ ok: true, summary: { id: 'c1', name: 'New', folderCount: 2 } });
    expect(await invoke(CHANNELS.addFolder, 'c1', '/d')).toEqual({ ok: true, view });
    expect(await invoke(CHANNELS.removeFolder, 'c1', 'f1')).toEqual({ ok: true, view });
    expect(await invoke(CHANNELS.deleteCollection, 'c1')).toEqual({ ok: true, deleted: true });
    expect(service.renameCollection).toHaveBeenCalledOnce();
    expect(service.renameCollection).toHaveBeenCalledWith('c1', 'New');
    expect(service.addFolder).toHaveBeenCalledWith('c1', '/d');
    expect(service.removeFolder).toHaveBeenCalledWith('c1', 'f1');
    expect(service.deleteCollection).toHaveBeenCalledWith('c1');
  });

  it('passes a service cancel through for delete, add folder and create', async () => {
    const canceled = async () => ({ canceled: true });
    const { invoke } = mk({ deleteCollection: canceled, addFolder: canceled });
    expect(await invoke(CHANNELS.deleteCollection, 'c1')).toEqual({ ok: true, canceled: true });
    expect(await invoke(CHANNELS.addFolder, 'c1', '/d')).toEqual({ ok: true, canceled: true });
    expect(await invoke(CHANNELS.createCollection, 'n', ['/d'])).toEqual({ ok: true, canceled: true });
  });

  it('returns error and code for COLLECTION_BUSY and LAST_FOLDER', async () => {
    const fail = (code) => async () => Object.assign(new Error(`failed ${code}`), { code });
    const reject = (code) => async () => { throw await fail(code)(); };
    const { invoke } = mk({ renameCollection: reject('COLLECTION_BUSY'), removeFolder: reject('LAST_FOLDER') });
    expect(await invoke(CHANNELS.renameCollection, 'c1', 'x')).toEqual({ ok: false, error: 'failed COLLECTION_BUSY', code: 'COLLECTION_BUSY' });
    expect(await invoke(CHANNELS.removeFolder, 'c1', 'f1')).toEqual({ ok: false, error: 'failed LAST_FOLDER', code: 'LAST_FOLDER' });
  });

  it('rejects non-string ids and paths before calling the service', async () => {
    const { service, invoke } = mk();
    for (const result of [
      await invoke(CHANNELS.renameCollection, 5, 'x'),
      await invoke(CHANNELS.renameCollection, 'c1', null),
      await invoke(CHANNELS.deleteCollection, undefined),
      await invoke(CHANNELS.addFolder, 'c1', 7),
      await invoke(CHANNELS.addFolder, {}, '/d'),
      await invoke(CHANNELS.removeFolder, 'c1', 3),
    ]) {
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe('string');
    }
    for (const fn of ['renameCollection', 'deleteCollection', 'addFolder', 'removeFolder']) expect(service[fn]).not.toHaveBeenCalled();
  });

  it('exposes the four methods in the preload with literal channel names', () => {
    const text = fs.readFileSync(new URL('../../src/main/preload.js', import.meta.url), 'utf8');
    expect(text).toMatch(/renameCollection:[^\n]*ipcRenderer\.invoke\('collections:rename',/);
    expect(text).toMatch(/deleteCollection:[^\n]*ipcRenderer\.invoke\('collections:delete',/);
    expect(text).toMatch(/addFolder:[^\n]*ipcRenderer\.invoke\('collections:addFolder',/);
    expect(text).toMatch(/removeFolder:[^\n]*ipcRenderer\.invoke\('collections:removeFolder',/);
  });
});

describe('main.js wiring', () => {
  const text = fs.readFileSync(new URL('../../src/main/main.js', import.meta.url), 'utf8');

  it('builds the confirmer and passes confirm and the shared guard to the collection service', () => {
    expect(text).toMatch(/createConfirmer\(\{[^}]*dialog[^}]*getWindow/);
    expect(text).toMatch(/createCollectionService\(\{[^}]*\bguard\b[^}]*\bconfirm\b[^}]*\}\)/);
  });

  it('creates the guard once, before the services, and passes the same one to the rescan service', () => {
    expect(text.match(/createInFlightGuard\(\)/g)).toHaveLength(1);
    expect(text).toMatch(/createRescanService\(\{[^}]*\bguard\b[^}]*\}\)/);
    expect(text.indexOf('createInFlightGuard()')).toBeLessThan(text.indexOf('createCollectionService({'));
  });

  it('a rescan in flight makes rename answer COLLECTION_BUSY through services wired as main.js wires them', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const { openStorage } = require('../../src/main/storage/index.js');
    const { createCollectionService } = require('../../src/main/collections/service.js');
    const { createRescanService } = require('../../src/main/collections/rescan.js');
    const { createInFlightGuard } = require('../../src/main/collections/in-flight.js');
    const { createConfirmer } = require('../../src/main/confirm.js');
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mo-wire-')));
    try {
      const dir = path.join(work, 'dir');
      fs.mkdirSync(dir);
      const storage = openStorage({ location: { file: path.join(work, 'store.json') } });
      let release;
      const gate = new Promise((r) => { release = r; });
      let gated = false;
      const scan = async () => { if (gated) await gate; return []; };
      const guard = createInFlightGuard();
      const confirm = createConfirmer({ dialog: { showMessageBox: async () => ({ response: 1 }) }, getWindow: () => null });
      const service = createCollectionService({ storage, guard, confirm, scan });
      const rescanService = createRescanService({ storage, guard, scan });
      const handlers = new Map();
      registerIpc({ ipcMain: { handle: (c, f) => handlers.set(c, f) }, dialog: {}, service, rescanService });
      const invoke = (c, ...a) => handlers.get(c)({}, ...a);

      const created = await invoke(CHANNELS.createCollection, 'c', [dir]);
      expect(created.ok).toBe(true);
      const id = created.summary.id;
      gated = true;
      const rescan = invoke(CHANNELS.rescanCollection, id);
      const renamed = await invoke(CHANNELS.renameCollection, id, 'other');
      expect(renamed).toMatchObject({ ok: false, code: 'COLLECTION_BUSY' });
      release();
      expect((await rescan).ok).toBe(true);
      expect((await invoke(CHANNELS.renameCollection, id, 'other')).ok).toBe(true);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
});
