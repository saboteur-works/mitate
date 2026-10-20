import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

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

describe('createCollection writes the store once (FR-18)', () => {
  const { createCountingFs } = require('../support/counting-fs.js');

  const folders = (n) =>
    Array.from({ length: n }, (_, i) => {
      const d = path.join(work, `src-${i}`);
      fs.mkdirSync(d);
      return d;
    });

  for (const n of [1, 3]) {
    it(`persists a collection of ${n} folder(s) in exactly one write`, async () => {
      const counter = createCountingFs();
      const storage = openStorage({ location: { file: storageFile }, fs: counter.impl });
      const svc = createCollectionService({ storage, scan: stubScan });
      const view = await svc.createCollection('c', folders(n));
      expect(counter.renames).toBe(1);
      const reopened = openStorage({ location: { file: storageFile } });
      expect(reopened.listFolders(view.collection.id)).toHaveLength(n);
      expect(reopened.getIndex({ collectionId: view.collection.id })).toHaveLength(n);
      expect(fs.readdirSync(path.dirname(storageFile))).toEqual(['store.json']);
    });
  }

  it('records unavailable folders in the same single write', async () => {
    const counter = createCountingFs();
    const storage = openStorage({ location: { file: storageFile }, fs: counter.impl });
    const failing = async () => {
      throw new Error('denied');
    };
    const view = await createCollectionService({ storage, scan: failing }).createCollection('c', folders(2));
    expect(counter.renames).toBe(1);
    const reopened = openStorage({ location: { file: storageFile } });
    expect(reopened.listFolders(view.collection.id).every((f) => f.unavailable)).toBe(true);
  });

  it('writes nothing and stores nothing when a mutation fails mid-creation', async () => {
    const counter = createCountingFs();
    const storage = openStorage({ location: { file: storageFile }, fs: counter.impl });
    const broken = {
      ...storage,
      replaceFolderIndex: () => {
        throw new Error('index failed');
      },
    };
    const svc = createCollectionService({ storage: broken, scan: stubScan });
    await expect(svc.createCollection('c', folders(2))).rejects.toThrow('index failed');
    expect(counter.renames).toBe(0);
    expect(storage.listCollections()).toEqual([]);
    expect(storage.listFolders()).toEqual([]);
  });
});

// Real unreadable folder (FR-4, FR-17). chmod happens only on a folder inside a
// temp copy of the fixture tree built here. Root bypasses mode bits, so the
// tests cannot make a folder unreadable there and are skipped.
const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe.skipIf(runningAsRoot)('real unreadable collection folder (mode 000)', () => {
  const { lockFolder, unlockFolder } = require('../support/fixture-tree.js');
  let copy;
  let locked; // Photos: becomes unreadable
  let open1; // Docs and Music: stay readable, snapshotted
  let open2;

  beforeEach(() => {
    copy = buildFixtureTree();
    locked = path.join(copy.root, 'Photos');
    open1 = path.join(copy.root, 'Docs');
    open2 = path.join(copy.root, 'Music');
  });
  afterEach(() => {
    // Restore permissions before the temp tree is removed, whatever happened.
    try {
      unlockFolder(locked);
    } finally {
      cleanupFixtureTree(copy.root);
    }
  });

  const lockedState = () => {
    const s = fs.statSync(locked);
    return { mode: s.mode & 0o777, ino: s.ino, mtimeMs: s.mtimeMs, uid: s.uid };
  };
  const snapOthers = (role) => [open1, open2].map((d) => readonly.snapshot(d, { role }));
  const assertOthersUnchanged = (before) => {
    const after = snapOthers('after');
    before.forEach((b, i) => expect(readonly.assert(b, after[i])).toBeDefined());
  };
  const assertLockedUntouched = (stateBefore, parentBefore) => {
    expect(lockedState()).toEqual(stateBefore);
    expect(stateBefore.mode).toBe(0);
    expect(fs.readdirSync(copy.root).sort()).toEqual(parentBefore);
  };

  it('create rejects the locked folder, naming it, stores nothing, and writes nothing there (FR-1, OQ-10)', async () => {
    lockFolder(locked);
    const stateBefore = lockedState();
    const parentBefore = fs.readdirSync(copy.root).sort();
    const before = snapOthers('before');

    await expect(service(runScan).createCollection('c', [locked, open1])).rejects.toThrow(
      new RegExp(`cannot be read: ${locked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(EACCES\\)`),
    );
    expect(openStorage({ location: { file: storageFile } }).listCollections()).toEqual([]);
    assertOthersUnchanged(before);
    assertLockedUntouched(stateBefore, parentBefore);
  });

  it('load on a re-instantiated service marks it unavailable and keeps its indexed files flagged', async () => {
    const created = await service(runScan).createCollection('c', [locked, open1]);
    const lockedId = created.folders.find((f) => f.path === locked).id;
    const indexed = created.files.filter((f) => f.folderId === lockedId);
    expect(indexed.length).toBeGreaterThan(0);

    lockFolder(locked);
    const stateBefore = lockedState();
    const parentBefore = fs.readdirSync(copy.root).sort();
    const before = snapOthers('before');

    const [loaded] = await service(throwingScan).loadCollections();
    expect(loaded.folders.find((f) => f.id === lockedId).unavailable).toBe(true);
    expect(loaded.folders.find((f) => f.path === open1).unavailable).toBe(false);
    const keptFiles = loaded.files.filter((f) => f.folderId === lockedId);
    expect(keptFiles).toHaveLength(indexed.length);
    expect(keptFiles.every((f) => f.unavailable === true)).toBe(true);
    expect(loaded.files.filter((f) => f.folderId !== lockedId).every((f) => !f.unavailable)).toBe(true);
    expect(openStorage({ location: { file: storageFile } }).getFolder(lockedId).unavailable).toBe(true);

    const [summary] = await service(throwingScan).listCollectionSummaries();
    expect(summary.folders.map((f) => [f.path, f.unavailable])).toEqual([
      [locked, true],
      [open1, false],
    ]);
    assertOthersUnchanged(before);
    assertLockedUntouched(stateBefore, parentBefore);
  });
});

// A folder whose details (stat) can be read but which cannot be opened for
// listing, failing with EPERM. Measured 2026-10-19 on an external drive:
// listing it (`ls`) and creating a folder in it failed with "Operation not
// permitted"; whether stat succeeds there was not measured, and why access was
// refused is not established (docs/measurements/atime-cat-read.md). A temp
// folder can't be put in that state, so opendir and the scan are made to fail
// with EPERM for one folder while stat and access still succeed.
describe('folder that cannot be opened for listing (EPERM, simulated)', () => {
  const { createRescanService } = require('../../src/main/collections/rescan.js');
  let copy;
  let refused;
  let open;
  let refusing = false;
  const eperm = (p) => Object.assign(new Error(`EPERM: operation not permitted, opendir '${p}'`), { code: 'EPERM' });
  const isRefused = (p) =>
    refusing && typeof p === 'string' && (p === refused || p.startsWith(refused + path.sep));

  beforeEach(() => {
    copy = buildFixtureTree();
    refused = path.join(copy.root, 'Photos');
    open = path.join(copy.root, 'Docs');
    refusing = false;
    const realOpendir = fs.promises.opendir;
    vi.spyOn(fs.promises, 'opendir').mockImplementation((p, ...rest) =>
      isRefused(p) ? Promise.reject(eperm(p)) : realOpendir.call(fs.promises, p, ...rest));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanupFixtureTree(copy.root);
  });

  const scan = (dir) => (isRefused(dir) ? Promise.reject(eperm(dir)) : runScan(dir));

  it('create rejects the folder with an error naming it and EPERM, and stores nothing', async () => {
    refusing = true;
    await expect(service(scan).createCollection('c', [refused, open])).rejects.toThrow(
      /cannot be read: .*Photos \(EPERM\)/,
    );
    expect(openStorage({ location: { file: storageFile } }).listCollections()).toEqual([]);
  });

  it('a folder that fails this way after creation is unavailable on load and keeps its stored files', async () => {
    const storageForTest = openStorage({ location: { file: storageFile } });
    const created = await createCollectionService({ storage: storageForTest, scan }).createCollection('c', [refused, open]);
    const refusedId = created.folders.find((f) => f.path === refused).id;
    const storedCount = created.files.filter((f) => f.folderId === refusedId).length;
    expect(storedCount).toBeGreaterThan(0);

    refusing = true;
    const reopened = createCollectionService({ storage: openStorage({ location: { file: storageFile } }), scan });
    const view = (await reopened.loadCollections()).find((v) => v.collection.id === created.collection.id);
    expect(view.folders.find((f) => f.id === refusedId).unavailable).toBe(true);
    const files = view.files.filter((f) => f.folderId === refusedId);
    expect(files.length).toBe(storedCount);
    expect(files.every((f) => f.unavailable === true)).toBe(true);
  });

  it('rescan skips a folder that fails this way after creation and still rescans the other', async () => {
    const storageForTest = openStorage({ location: { file: storageFile } });
    const created = await createCollectionService({ storage: storageForTest, scan }).createCollection('c', [refused, open]);
    const refusedId = created.folders.find((f) => f.path === refused).id;
    const openId = created.folders.find((f) => f.path === open).id;

    refusing = true;
    const result = await createRescanService({ storage: storageForTest, scan }).rescanCollection(created.collection.id);
    expect(result.folders.find((f) => f.id === refusedId).unavailable).toBe(true);
    expect(result.summary.skipped).toContain(refusedId);
    expect(result.summary.rescanned).toContain(openId);
  });
});

describe('launch availability check writes the store once', () => {
  const { createCountingFs } = require('../support/counting-fs.js');

  it('marks two folders that disappeared unavailable in a single write (FR-18)', async () => {
    const dirs = ['gone-a', 'gone-b', 'stays'].map((n) => {
      const d = path.join(work, n);
      fs.mkdirSync(d);
      return d;
    });
    await service().createCollection('c', dirs);
    fs.rmdirSync(dirs[0]);
    fs.rmdirSync(dirs[1]);

    const counter = createCountingFs();
    const storage = openStorage({ location: { file: storageFile }, fs: counter.impl });
    const [loaded] = await createCollectionService({ storage, scan: throwingScan }).loadCollections();
    expect(loaded.folders.filter((f) => f.unavailable)).toHaveLength(2);
    expect(counter.renames).toBe(1);
  });
});

describe('availability check across collections', () => {
  it('checks the folders of several collections and persists all flag changes in one write (FR-18)', async () => {
    const { createCountingFs } = require('../support/counting-fs.js');
    const dirs = ['one', 'two', 'three'].map((n) => {
      const d = path.join(work, n);
      fs.mkdirSync(d);
      return d;
    });
    const svc = service();
    await svc.createCollection('a', [dirs[0]]);
    await svc.createCollection('b', [dirs[1], dirs[2]]);
    fs.rmdirSync(dirs[0]);
    fs.rmdirSync(dirs[2]);

    const counter = createCountingFs();
    const storage = openStorage({ location: { file: storageFile }, fs: counter.impl });
    const summaries = await createCollectionService({ storage, scan: throwingScan }).listCollectionSummaries();
    expect(summaries.map((s) => s.folders.map((f) => f.unavailable))).toEqual([[true], [false, true]]);
    expect(counter.renames).toBe(1);
  });
});

describe('rescan of a collection removed while it is scanning', () => {
  const { createRescanService } = require('../../src/main/collections/rescan.js');

  it('rejects instead of returning an empty view as a success', async () => {
    const d = path.join(work, 'removed-mid-rescan');
    fs.mkdirSync(d);
    const storage = openStorage({ location: { file: storageFile } });
    const created = await createCollectionService({ storage, scan: stubScan }).createCollection('c', [d]);
    const scan = async (dir) => {
      storage.removeCollection(created.collection.id);
      return stubScan(dir);
    };
    await expect(createRescanService({ storage, scan }).rescanCollection(created.collection.id)).rejects.toThrow(
      /no longer exists/,
    );
  });
});
