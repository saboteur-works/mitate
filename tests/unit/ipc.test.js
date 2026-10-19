import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { registerIpc, CHANNELS } = require('../../src/main/ipc.js');

function setup({ dialogResult = { canceled: false, filePaths: ['/a', '/b'] }, service } = {}) {
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
    createCollection: async (name, dirs) => ({ collection: { name }, folders: dirs.map((d) => ({ path: d })), files: [] }),
    loadCollections: async () => [],
  };
  registerIpc({ ipcMain, dialog, service: svc });
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
    expect(created.view.collection.name).toBe('N');
    expect(await invoke(CHANNELS.listCollections)).toEqual({ ok: true, views: [] });
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
      loadCollections: async () => { throw new Error('boom'); },
    };
    const { invoke } = setup({ service });
    expect(await invoke(CHANNELS.createCollection, '', [])).toEqual({ ok: false, error: 'bad name' });
    expect(await invoke(CHANNELS.listCollections)).toEqual({ ok: false, error: 'boom' });
  });
});
