import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');
const { registerIpc, CHANNELS } = require('../../src/main/ipc.js');
const { runScan } = require('../../src/main/discovery/run-scan.js');
const readonly = require('../../tools/readonly-check/index.js');

let fixture;
let work; // holds storage and throwaway folders, outside the fixture tree
let storageFile;

const throwingScan = () => {
  throw new Error('scan must not be called');
};
const stubScan = async (dir) => [
  { path: path.join(dir, 'a.jpg'), relativePath: 'a.jpg', name: 'a.jpg', extension: 'jpg', kind: 'image' },
];

beforeAll(() => {
  fixture = buildFixtureTree();
});
afterAll(() => {
  if (fixture) cleanupFixtureTree(fixture.root);
});
beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mo-svc-')));
  storageFile = path.join(work, 'app-data', 'store.json');
});
afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

const service = (scan = stubScan) =>
  createCollectionService({ storage: openStorage({ location: { file: storageFile } }), scan });

describe('createCollection validation', () => {
  it('rejects empty and whitespace names', async () => {
    const s = service();
    await expect(s.createCollection('', [fixture.root])).rejects.toThrow(/name/);
    await expect(s.createCollection('   ', [fixture.root])).rejects.toThrow(/name/);
  });

  it('rejects an empty directory list', async () => {
    await expect(service().createCollection('x', [])).rejects.toThrow(/folder/i);
  });

  it('rejects a path that is a file', async () => {
    const file = fixture.manifest.files[0].path;
    await expect(service().createCollection('x', [file])).rejects.toThrow(/Not a directory/);
  });

  it('rejects relative and missing paths', async () => {
    const s = service();
    await expect(s.createCollection('x', ['relative/dir'])).rejects.toThrow(/absolute/);
    await expect(s.createCollection('x', [path.join(work, 'nope')])).rejects.toThrow(/does not exist/);
  });

  it('stores nothing when validation fails', async () => {
    const s = service();
    await expect(s.createCollection('x', [fixture.root, fixture.manifest.files[0].path])).rejects.toThrow();
    expect(openStorage({ location: { file: storageFile } }).listCollections()).toEqual([]);
  });
});

describe('FR-13 storage location', () => {
  it('rejects a directory that contains the storage file', async () => {
    await expect(service().createCollection('x', [work])).rejects.toThrow(/storage location/);
    fs.mkdirSync(path.dirname(storageFile), { recursive: true });
    await expect(service().createCollection('x', [path.dirname(storageFile)])).rejects.toThrow(/storage location/);
  });

  const serviceAt = (file) =>
    createCollectionService({ storage: openStorage({ location: { file } }), scan: stubScan });

  it('rejects a storage file inside a child directory named like "..appdata"', async () => {
    const coll = path.join(work, 'coll');
    const child = path.join(coll, '..appdata');
    fs.mkdirSync(child, { recursive: true });
    await expect(serviceAt(path.join(child, 'store.json')).createCollection('x', [coll])).rejects.toThrow(
      /storage location/,
    );
  });

  it('accepts a storage file in a sibling directory of the collection folder', async () => {
    const coll = path.join(work, 'coll');
    const sibling = path.join(work, 'coll-appdata');
    fs.mkdirSync(coll);
    fs.mkdirSync(sibling);
    const created = await serviceAt(path.join(sibling, 'store.json')).createCollection('x', [coll]);
    expect(created.folders).toHaveLength(1);
  });

  it('accepts a storage file in the parent directory of the collection folder', async () => {
    const coll = path.join(work, 'coll');
    fs.mkdirSync(coll);
    const created = await serviceAt(path.join(work, 'store.json')).createCollection('x', [coll]);
    expect(created.folders).toHaveLength(1);
  });

  it('stored collections never contain the storage file', async () => {
    const s = service();
    const created = await s.createCollection('x', [fixture.root]);
    const file = fs.realpathSync(storageFile);
    for (const f of created.folders) {
      const rel = path.relative(fs.realpathSync(f.path), file);
      expect(rel.startsWith('..') || path.isAbsolute(rel)).toBe(true);
    }
  });
});

describe('persistence and load', () => {
  it('create then re-instantiate returns collection, folders and index with no scan', async () => {
    const created = await service(runScan).createCollection('Photos', [fixture.root]);
    expect(created.files.length).toBeGreaterThan(0);

    const reloaded = await service(throwingScan).loadCollections();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].collection.name).toBe('Photos');
    expect(reloaded[0].folders.map((f) => f.path)).toEqual([fixture.root]);
    expect(reloaded[0].folders[0].unavailable).toBe(false);
    expect(reloaded[0].files).toEqual(created.files);
    expect(reloaded[0].files.every((f) => !f.unavailable)).toBe(true);
  });

  it('getCollectionView returns the view, or null for an unknown id', async () => {
    const s = service();
    const created = await s.createCollection('x', [fixture.root]);
    expect(s.getCollectionView(created.collection.id)).toEqual(created);
    expect(s.getCollectionView('missing')).toBeNull();
  });

  it('marks a removed folder unavailable, keeping records and flagging files', async () => {
    const gone = path.join(work, 'gone');
    fs.mkdirSync(gone);
    const created = await service().createCollection('x', [gone, fixture.root]);
    fs.rmSync(gone, { recursive: true });

    const reloaded = (await service(throwingScan).loadCollections())[0];
    const goneFolder = reloaded.folders.find((f) => f.path === gone);
    expect(goneFolder.unavailable).toBe(true);
    expect(reloaded.folders).toHaveLength(2);
    const goneFiles = reloaded.files.filter((f) => f.folderId === goneFolder.id);
    expect(goneFiles).toHaveLength(1);
    expect(goneFiles.every((f) => f.unavailable === true)).toBe(true);
    expect(reloaded.files.filter((f) => f.folderId !== goneFolder.id).every((f) => !f.unavailable)).toBe(true);
    expect(reloaded.files).toHaveLength(created.files.length);
    expect(openStorage({ location: { file: storageFile } }).getFolder(goneFolder.id).unavailable).toBe(true);
  });

  it('marks a folder available again when it returns', async () => {
    const dir = path.join(work, 'back');
    fs.mkdirSync(dir);
    await service().createCollection('x', [dir]);
    fs.rmdirSync(dir);
    expect((await service(throwingScan).loadCollections())[0].files[0].unavailable).toBe(true);
    fs.mkdirSync(dir);
    const again = (await service(throwingScan).loadCollections())[0];
    expect(again.folders[0].unavailable).toBe(false);
    expect(again.files[0].unavailable).toBeUndefined();
  });

  it('records a folder whose scan fails as unavailable instead of failing creation', async () => {
    const dir = path.join(work, 'locked');
    fs.mkdirSync(dir);
    const s = service(async () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });
    const created = await s.createCollection('x', [dir]);
    expect(created.folders[0].unavailable).toBe(true);
    expect(created.files).toEqual([]);
  });
});

// Returns the paths of every object in the payload that looks like a file record.
function findFileRecords(value, where = '$') {
  if (Array.isArray(value)) return value.flatMap((v, i) => findFileRecords(v, `${where}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  const here = 'extension' in value || 'relativePath' in value ? [where] : [];
  return here.concat(Object.entries(value).flatMap(([k, v]) => findFileRecords(v, `${where}.${k}`)));
}

describe('collection list payload (summaries only)', () => {
  async function listPayload(s) {
    const handlers = new Map();
    registerIpc({ ipcMain: { handle: (c, fn) => handlers.set(c, fn) }, dialog: {}, service: s });
    return handlers.get(CHANNELS.listCollections)({});
  }

  it('carries name, id, folder count and per-folder unavailable, with no file records', async () => {
    const gone = path.join(work, 'gone');
    fs.mkdirSync(gone);
    const created = await service(runScan).createCollection('Mixed', [gone, fixture.root]);
    expect(created.files.length).toBeGreaterThan(0);
    fs.rmSync(gone, { recursive: true });

    const payload = await listPayload(service(throwingScan));
    expect(payload.ok).toBe(true);
    expect(findFileRecords(payload)).toEqual([]);

    const [summary] = payload.summaries;
    expect(summary.id).toBe(created.collection.id);
    expect(summary.name).toBe('Mixed');
    expect(summary.folderCount).toBe(2);
    expect(summary.folders.map((f) => [f.path, f.unavailable])).toEqual([
      [gone, true],
      [fixture.root, false],
    ]);
    expect(summary.folders.every((f) => typeof f.id === 'string')).toBe(true);
  });

  it('listCollectionSummaries persists unavailable flags without reading the index', async () => {
    const dir = path.join(work, 'vanish');
    fs.mkdirSync(dir);
    await service().createCollection('x', [dir]);
    fs.rmdirSync(dir);
    const storage = openStorage({ location: { file: storageFile } });
    storage.getIndex = () => {
      throw new Error('index must not be read');
    };
    const [summary] = await createCollectionService({ storage, scan: throwingScan }).listCollectionSummaries();
    expect(summary.folders[0].unavailable).toBe(true);
    expect(openStorage({ location: { file: storageFile } }).getFolder(summary.folders[0].id).unavailable).toBe(true);
  });
});

describe('collection view from per-folder lookups', () => {
  it('returns every folder file in folder order, then index order', async () => {
    const rec = (dir, name) => ({
      path: path.join(dir, name), relativePath: name, name, extension: name.split('.')[1], kind: 'image',
    });
    const dirA = path.join(work, 'a');
    const dirB = path.join(work, 'b');
    const dirC = path.join(work, 'c');
    for (const d of [dirA, dirB, dirC]) fs.mkdirSync(d);
    const byDir = { [dirA]: [rec(dirA, 'z.jpg'), rec(dirA, 'a.png')], [dirB]: [], [dirC]: [rec(dirC, 'm.gif')] };
    const s = service(async (dir) => byDir[dir]);
    const created = await s.createCollection('multi', [dirA, dirB, dirC]);
    const expected = ['z.jpg', 'a.png', 'm.gif'];
    expect(created.files.map((f) => f.name)).toEqual(expected);
    expect(s.getCollectionView(created.collection.id).files.map((f) => f.name)).toEqual(expected);
    const [fa, , fc] = created.folders;
    expect(created.files.map((f) => f.folderId)).toEqual([fa.id, fa.id, fc.id]);
  });
});

describe('read-only (FR-13)', () => {
  it('create and load leave the fixture tree unchanged', async () => {
    const before = readonly.snapshot(fixture.root, { role: 'before' });
    await service(runScan).createCollection('ro', [fixture.root]);
    await service(throwingScan).loadCollections();
    const after = readonly.snapshot(fixture.root, { role: 'after' });
    expect(readonly.assert(before, after)).toBeDefined();
  });
});
