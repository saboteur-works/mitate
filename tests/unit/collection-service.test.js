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
    const { dropped, ...created } = await s.createCollection('x', [fixture.root]);
    expect(dropped).toEqual([]);
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

describe('summary folder order', () => {
  it('lists folders in folderIds order, as the view does, with unlisted ones last by id', async () => {
    const dirs = ['a', 'b', 'c'].map((n) => path.join(work, n));
    for (const d of dirs) fs.mkdirSync(d);
    const s = service();
    const { collection, folders } = await s.createCollection('ordered', dirs);
    const storage = openStorage({ location: { file: storageFile } });
    // Reverse the list and drop the first folder from it (a stale folderIds).
    storage.putCollection({ ...collection, folderIds: [folders[2].id, folders[1].id] });
    const reread = createCollectionService({ storage: openStorage({ location: { file: storageFile } }), scan: throwingScan });
    const [summary] = await reread.listCollectionSummaries();
    const fromView = reread.getCollectionView(collection.id).folders.map((f) => f.id);
    expect(summary.folders.map((f) => f.id)).toEqual(fromView);
    expect(fromView).toEqual([folders[2].id, folders[1].id, folders[0].id]);
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

describe('availability check of a folder removed while it is pending', () => {
  it('skips the removed folder instead of failing listCollectionSummaries', async () => {
    const dirs = ['keep', 'gone'].map((n) => {
      const d = path.join(work, n);
      fs.mkdirSync(d);
      return d;
    });
    const storage = openStorage({ location: { file: storageFile } });
    const svc = createCollectionService({ storage, scan: stubScan });
    const created = await svc.createCollection('c', dirs);
    // Both folders turn unreadable, so both flag changes are due when the checks finish.
    for (const d of dirs) fs.rmdirSync(d);
    const gone = created.folders[1];
    const pending = svc.listCollectionSummaries();
    storage.removeFolder(gone.id); // while the readability checks are pending
    const summaries = await pending;
    expect(summaries[0].folders.map((f) => f.path)).toEqual([dirs[0]]);
    expect(summaries[0].folders[0].unavailable).toBe(true);
    expect(storage.getFolder(gone.id)).toBeFalsy();
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

describe('findIndexedFile', () => {
  async function setup() {
    const root = path.join(work, 'find-root');
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    const storage = openStorage({ location: { file: storageFile } });
    const svc = createCollectionService({ storage, scan: stubScan });
    const view = await svc.createCollection('c', [root]);
    return { root, storage, svc, view };
  }

  it('returns the stored record for an indexed file path', async () => {
    const { root, svc, view } = await setup();
    const found = svc.findIndexedFile(path.join(root, 'a.jpg'));
    expect(found).toEqual(view.files[0]);
    expect(found.name).toBe('a.jpg');
  });

  it('returns null for a path that is not indexed', async () => {
    const { root, svc } = await setup();
    expect(svc.findIndexedFile(path.join(root, 'other.jpg'))).toBeNull();
  });

  it('returns null for a folder path (root or subfolder)', async () => {
    const { root, svc } = await setup();
    expect(svc.findIndexedFile(root)).toBeNull();
    expect(svc.findIndexedFile(path.join(root, 'sub'))).toBeNull();
  });

  it('returns null when the path differs by trailing segment or case', async () => {
    const { root, svc } = await setup();
    const file = path.join(root, 'a.jpg');
    expect(svc.findIndexedFile(file + path.sep)).toBeNull();
    expect(svc.findIndexedFile(path.join(file, 'x'))).toBeNull();
    expect(svc.findIndexedFile(path.join(root, 'A.jpg'))).toBeNull();
    expect(svc.findIndexedFile(path.join(root, 'a.jp'))).toBeNull();
  });

  it('still finds a file whose folder is unavailable', async () => {
    const { root, svc } = await setup();
    fs.rmSync(root, { recursive: true });
    const summaries = await svc.listCollectionSummaries();
    expect(summaries[0].folders[0].unavailable).toBe(true);
    const found = svc.findIndexedFile(path.join(root, 'a.jpg'));
    expect(found).not.toBeNull();
    expect(found.name).toBe('a.jpg');
  });

  it('leaves the stored index unchanged and does not touch the file system', async () => {
    const { root, storage, svc } = await setup();
    const before = JSON.stringify(storage.getIndex());
    const storeBefore = fs.readFileSync(storageFile, 'utf8');
    const names = ['statSync', 'lstatSync', 'existsSync', 'readdirSync', 'readFileSync', 'writeFileSync', 'renameSync', 'openSync'];
    const spies = names.map((name) => vi.spyOn(fs, name));
    const statSpy = vi.spyOn(fs.promises, 'stat');
    try {
      svc.findIndexedFile(path.join(root, 'a.jpg'));
      svc.findIndexedFile(path.join(root, 'missing.jpg'));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(statSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
    expect(JSON.stringify(storage.getIndex())).toBe(before);
    expect(fs.readFileSync(storageFile, 'utf8')).toBe(storeBefore);
  });
});

describe('renameCollection and removeFolder', () => {
  const { createInFlightGuard } = require('../../src/main/collections/in-flight.js');

  function countingFs() {
    const c = { renames: 0, fail: null };
    return {
      c,
      fs: {
        renameSync(a, b) {
          c.renames += 1;
          return fs.renameSync(a, b);
        },
      },
    };
  }

  function dirs(...names) {
    return names.map((n) => {
      const d = path.join(work, n);
      fs.mkdirSync(d, { recursive: true });
      return d;
    });
  }

  async function setup(wrap = (s) => s) {
    const counter = countingFs();
    const storage = wrap(openStorage({ location: { file: storageFile }, fs: counter.fs }));
    const guard = createInFlightGuard();
    const svc = createCollectionService({ storage, scan: stubScan, guard });
    const [a, b, c] = dirs('a', 'b', 'c');
    const one = await svc.createCollection('One', [a, b]);
    const two = await svc.createCollection('Two', [a, c]); // same path a as One
    const solo = await svc.createCollection('Solo', [c]);
    counter.c.renames = 0;
    return { svc, storage, guard, counter: counter.c, one, two, solo, a, b, c };
  }
  const raw = () => fs.readFileSync(storageFile, 'utf8');

  it('rename trims, changes only the name, and writes once', async () => {
    const { svc, storage, counter, one } = await setup();
    const before = {
      folders: JSON.stringify(storage.listFolders(one.collection.id)),
      index: JSON.stringify(storage.getIndex({ collectionId: one.collection.id })),
      ids: JSON.stringify(storage.getCollection(one.collection.id).folderIds),
    };
    const view = await svc.renameCollection(one.collection.id, '  Renamed  ');
    expect(view.collection.name).toBe('Renamed');
    expect(storage.getCollection(one.collection.id).name).toBe('Renamed');
    expect(JSON.stringify(storage.getCollection(one.collection.id).folderIds)).toBe(before.ids);
    expect(JSON.stringify(storage.listFolders(one.collection.id))).toBe(before.folders);
    expect(JSON.stringify(storage.getIndex({ collectionId: one.collection.id }))).toBe(before.index);
    expect(counter.renames).toBe(1);
  });

  it('rename rejects empty and whitespace names and leaves the store unchanged', async () => {
    const { svc, counter, one } = await setup();
    const before = raw();
    await expect(svc.renameCollection(one.collection.id, '')).rejects.toThrow(/name/);
    await expect(svc.renameCollection(one.collection.id, '   ')).rejects.toThrow(/name/);
    expect(raw()).toBe(before);
    expect(counter.renames).toBe(0);
  });

  it('rename accepts a duplicate name and a 5000-character name', async () => {
    const { svc, storage, one, two } = await setup();
    await svc.renameCollection(one.collection.id, 'Two');
    expect(storage.getCollection(one.collection.id).name).toBe('Two');
    expect(storage.getCollection(two.collection.id).name).toBe('Two');
    const long = 'x'.repeat(5000);
    await svc.renameCollection(one.collection.id, long);
    expect(storage.getCollection(one.collection.id).name).toBe(long);
  });

  it('rename rejects an unknown collection id', async () => {
    const { svc } = await setup();
    const before = raw();
    await expect(svc.renameCollection('nope', 'X')).rejects.toThrow(/Unknown collection/);
    expect(raw()).toBe(before);
  });

  it('removeFolder removes record, index and id, returns the view, and spares a same-path folder', async () => {
    const { svc, storage, counter, one, two, a } = await setup();
    const target = one.folders.find((f) => f.path === a);
    const otherBefore = JSON.stringify({
      c: storage.getCollection(two.collection.id),
      f: storage.listFolders(two.collection.id),
      i: storage.getIndex({ collectionId: two.collection.id }),
    });
    const view = await svc.removeFolder(one.collection.id, target.id);
    expect(storage.getFolder(target.id)).toBeUndefined();
    expect(storage.getIndex({ folderId: target.id })).toEqual([]);
    expect(storage.getCollection(one.collection.id).folderIds).not.toContain(target.id);
    expect(view.folders.map((f) => f.id)).toEqual(storage.getCollection(one.collection.id).folderIds);
    expect(view.files.every((f) => f.folderId !== target.id)).toBe(true);
    expect(view.files.length).toBe(1);
    expect(JSON.stringify({
      c: storage.getCollection(two.collection.id),
      f: storage.listFolders(two.collection.id),
      i: storage.getIndex({ collectionId: two.collection.id }),
    })).toBe(otherBefore);
    expect(counter.renames).toBe(1);
  });

  it('removeFolder refuses the only folder with LAST_FOLDER', async () => {
    const { svc, counter, solo } = await setup();
    const before = raw();
    const err = await svc.removeFolder(solo.collection.id, solo.folders[0].id).catch((e) => e);
    expect(err.code).toBe('LAST_FOLDER');
    expect(err.message).toMatch(/delete the collection/i);
    expect(raw()).toBe(before);
    expect(counter.renames).toBe(0);
  });

  it('removeFolder rejects a folder of another collection and changes nothing', async () => {
    const { svc, one, two } = await setup();
    const before = raw();
    await expect(svc.removeFolder(one.collection.id, two.folders[0].id)).rejects.toThrow(/does not belong/);
    await expect(svc.removeFolder(one.collection.id, 'nope')).rejects.toThrow(/does not belong/);
    await expect(svc.removeFolder('nope', two.folders[0].id)).rejects.toThrow(/Unknown collection/);
    expect(raw()).toBe(before);
  });

  it('both operations reject with COLLECTION_BUSY while the guard is held; others succeed', async () => {
    const { svc, guard, one, two } = await setup();
    const release = guard.acquire(one.collection.id, 'add-folder');
    const before = raw();
    const e1 = await svc.renameCollection(one.collection.id, 'X').catch((e) => e);
    const e2 = await svc.removeFolder(one.collection.id, one.folders[0].id).catch((e) => e);
    expect(e1.code).toBe('COLLECTION_BUSY');
    expect(e2.code).toBe('COLLECTION_BUSY');
    expect(raw()).toBe(before);
    expect(guard.holder(one.collection.id)).toBe('add-folder');
    await expect(svc.renameCollection(two.collection.id, 'Y')).resolves.toBeTruthy();
    await expect(svc.removeFolder(two.collection.id, two.folders[0].id)).resolves.toBeTruthy();
    release();
    await expect(svc.renameCollection(one.collection.id, 'X')).resolves.toBeTruthy();
    expect(guard.isBusy(one.collection.id)).toBe(false);
  });

  it('a failure after the first write inside the transaction leaves the store unchanged', async () => {
    const { svc, guard, one } = await setup((s) => ({
      ...s,
      removeFolder() {
        throw new Error('injected');
      },
    }));
    const before = raw();
    const storage = openStorage({ location: { file: storageFile } });
    await expect(svc.removeFolder(one.collection.id, one.folders[0].id)).rejects.toThrow('injected');
    expect(raw()).toBe(before);
    expect(storage.getFolder(one.folders[0].id)).toBeDefined();
    expect(storage.getIndex({ folderId: one.folders[0].id }).length).toBe(1);
    expect(guard.isBusy(one.collection.id)).toBe(false);
  });
});

describe('deleteCollection', () => {
  const { createInFlightGuard } = require('../../src/main/collections/in-flight.js');
  const { createRescanService } = require('../../src/main/collections/rescan.js');

  function dirs(...names) {
    return names.map((n) => {
      const d = path.join(work, n);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'keep.txt'), 'x');
      return d;
    });
  }
  const raw = () => fs.readFileSync(storageFile, 'utf8');
  const listing = (d) => fs.readdirSync(d, { recursive: true }).sort();

  async function setup({ confirm, wrap = (s) => s, scan = stubScan } = {}) {
    const calls = { writes: 0, confirms: [], atConfirm: [] };
    const storage = wrap(openStorage({
      location: { file: storageFile },
      fs: { renameSync(a, b) { calls.writes += 1; return fs.renameSync(a, b); } },
    }));
    const guard = createInFlightGuard();
    const wrapped = confirm === undefined ? undefined : async (req) => {
      calls.confirms.push(req);
      calls.atConfirm.push(calls.writes);
      return confirm(req);
    };
    const svc = createCollectionService({ storage, scan, guard, confirm: wrapped });
    const [a, b, c] = dirs('a', 'b', 'c');
    const one = await svc.createCollection('One', [a, b]);
    const two = await svc.createCollection('Two', [a, b]); // same folder paths
    const other = await svc.createCollection('Other', [c]);
    calls.writes = 0;
    return { svc, storage, guard, calls, one, two, other, a, b, c };
  }

  it('asks before any write with the name, a no-files-touched statement and the label', async () => {
    const { svc, calls, one } = await setup({ confirm: () => true });
    await svc.deleteCollection(one.collection.id);
    expect(calls.confirms.length).toBe(1);
    expect(calls.atConfirm[0]).toBe(0);
    const req = calls.confirms[0];
    expect(`${req.message} ${req.detail}`).toContain('One');
    expect(`${req.message} ${req.detail}`).toMatch(/No files on disk are touched/);
    expect(req.confirmLabel).toBe('Delete collection');
  });

  it('confirm true removes collection, folders, indexes and access; a same-path collection is byte-identical', async () => {
    const { svc, storage, calls, one, two } = await setup({ confirm: () => true });
    for (const f of one.folders) storage.setFolderAccess(f.id, { token: 't' });
    const twoBefore = JSON.stringify({
      c: storage.getCollection(two.collection.id),
      f: storage.listFolders(two.collection.id),
      i: storage.getIndex({ collectionId: two.collection.id }),
      a: two.folders.map((f) => storage.getFolderAccess(f.id)),
    });
    calls.writes = 0;
    await expect(svc.deleteCollection(one.collection.id)).resolves.toEqual({ deleted: true });
    const fresh = openStorage({ location: { file: storageFile } });
    expect(fresh.getCollection(one.collection.id)).toBeUndefined();
    for (const f of one.folders) {
      expect(fresh.getFolder(f.id)).toBeUndefined();
      expect(fresh.getIndex({ folderId: f.id })).toEqual([]);
      expect(fresh.getFolderAccess(f.id)).toBeUndefined();
    }
    expect(JSON.stringify({
      c: fresh.getCollection(two.collection.id),
      f: fresh.listFolders(two.collection.id),
      i: fresh.getIndex({ collectionId: two.collection.id }),
      a: two.folders.map((f) => fresh.getFolderAccess(f.id)),
    })).toBe(twoBefore);
    expect(calls.writes).toBe(1);
  });

  it('confirm false resolves canceled and the store is unchanged and not written', async () => {
    const { svc, calls, one } = await setup({ confirm: () => false });
    const before = raw();
    await expect(svc.deleteCollection(one.collection.id)).resolves.toEqual({ canceled: true });
    expect(raw()).toBe(before);
    expect(calls.writes).toBe(0);
  });

  it('without an injected confirm the result is canceled and nothing is written', async () => {
    const { svc, calls, one } = await setup();
    const before = raw();
    await expect(svc.deleteCollection(one.collection.id)).resolves.toEqual({ canceled: true });
    expect(raw()).toBe(before);
    expect(calls.writes).toBe(0);
  });

  it('an unknown id rejects without asking', async () => {
    const { svc, calls } = await setup({ confirm: () => true });
    const before = raw();
    await expect(svc.deleteCollection('nope')).rejects.toThrow(/Unknown collection/);
    expect(calls.confirms.length).toBe(0);
    expect(raw()).toBe(before);
  });

  it('holds the guard while confirm is pending and releases it afterwards', async () => {
    let answer;
    const pending = new Promise((r) => { answer = r; });
    const { svc, guard, calls, one, two, other } = await setup({ confirm: () => pending });
    const del = svc.deleteCollection(one.collection.id);
    await Promise.resolve();
    expect(calls.confirms.length).toBe(1);
    expect(guard.holder(one.collection.id)).toBe('delete');
    const rescan = createRescanService({ storage: openStorage({ location: { file: storageFile } }), scan: stubScan, guard });
    const errs = await Promise.all([
      svc.renameCollection(one.collection.id, 'X').catch((e) => e),
      svc.removeFolder(one.collection.id, one.folders[0].id).catch((e) => e),
      rescan.rescanCollection(one.collection.id).catch((e) => e),
    ]);
    for (const e of errs) expect(e.code).toBe('COLLECTION_BUSY');
    await expect(svc.renameCollection(other.collection.id, 'Y')).resolves.toBeTruthy();
    await expect(svc.renameCollection(two.collection.id, 'Z')).resolves.toBeTruthy();
    answer(true);
    await expect(del).resolves.toEqual({ deleted: true });
    expect(guard.isBusy(one.collection.id)).toBe(false);
  });

  it('releases the guard after cancel and after a throwing confirm', async () => {
    const canceled = await setup({ confirm: () => false });
    await canceled.svc.deleteCollection(canceled.one.collection.id);
    expect(canceled.guard.isBusy(canceled.one.collection.id)).toBe(false);

    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const throwing = await setup({ confirm: () => { throw new Error('dialog failed'); } });
    const before = raw();
    await expect(throwing.svc.deleteCollection(throwing.one.collection.id)).rejects.toThrow('dialog failed');
    expect(throwing.guard.isBusy(throwing.one.collection.id)).toBe(false);
    expect(raw()).toBe(before);
  });

  it('rejects with COLLECTION_BUSY before asking when the guard is already held', async () => {
    const { svc, guard, calls, one } = await setup({ confirm: () => true });
    const release = guard.acquire(one.collection.id, 'rescan');
    const before = raw();
    const err = await svc.deleteCollection(one.collection.id).catch((e) => e);
    expect(err.code).toBe('COLLECTION_BUSY');
    expect(calls.confirms.length).toBe(0);
    expect(raw()).toBe(before);
    expect(guard.holder(one.collection.id)).toBe('rescan');
    release();
  });

  it('a throwing storage.removeCollection leaves the store unchanged and releases the guard', async () => {
    const { svc, guard, one } = await setup({
      confirm: () => true,
      wrap: (s) => ({ ...s, removeCollection() { throw new Error('injected'); } }),
    });
    const before = raw();
    await expect(svc.deleteCollection(one.collection.id)).rejects.toThrow('injected');
    expect(raw()).toBe(before);
    expect(guard.isBusy(one.collection.id)).toBe(false);
  });

  it('touches no file system path: scan is never called and the folders are unchanged', async () => {
    const { a, b, one } = await setup({ confirm: () => true });
    // A second service over the same store whose scan fails if called.
    const strict = createCollectionService({
      storage: openStorage({ location: { file: storageFile } }),
      scan: throwingScan,
      confirm: async () => true,
    });
    const before = [listing(a), listing(b)];
    await expect(strict.deleteCollection(one.collection.id)).resolves.toEqual({ deleted: true });
    expect([listing(a), listing(b)]).toEqual(before);
  });
});

describe('addFolder', () => {
  const { createInFlightGuard } = require('../../src/main/collections/in-flight.js');
  const { createRescanService } = require('../../src/main/collections/rescan.js');

  const mk = (...parts) => {
    const d = path.join(work, ...parts);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const raw = () => fs.readFileSync(storageFile, 'utf8');
  const text = (req) => `${req.message} ${req.detail}`;

  // One collection "One" with folder `base` (work/base), plus "Other" with `elsewhere`.
  async function setup({ confirm, wrap = (s) => s, scan: scanImpl } = {}) {
    const calls = { writes: 0, scans: [], confirms: [] };
    const scan = async (dir) => {
      calls.scans.push(dir);
      return (scanImpl || stubScan)(dir);
    };
    const storage = wrap(openStorage({
      location: { file: storageFile },
      fs: { renameSync(a, b) { calls.writes += 1; return fs.renameSync(a, b); } },
    }));
    const guard = createInFlightGuard();
    const wrapped = confirm === undefined ? undefined : async (req) => {
      calls.confirms.push(req);
      return confirm(req);
    };
    const svc = createCollectionService({ storage, scan, guard, confirm: wrapped });
    const base = mk('base');
    const elsewhere = mk('elsewhere');
    const one = await svc.createCollection('One', [base]);
    const other = await svc.createCollection('Other', [elsewhere]);
    calls.writes = 0;
    calls.scans.length = 0;
    return { svc, storage, guard, calls, one, other, base, elsewhere };
  }

  it('adds a readable absolute directory: indexed, id appended, only it scanned, one write, no confirm', async () => {
    const { svc, calls, one } = await setup({ confirm: () => true });
    const dir = mk('new');
    const view = await svc.addFolder(one.collection.id, dir);
    expect(calls.scans).toEqual([dir]);
    expect(calls.writes).toBe(1);
    expect(calls.confirms.length).toBe(0);
    const added = view.folders.find((f) => f.path === dir);
    expect(added.unavailable).toBe(false);
    expect(view.collection.folderIds).toEqual([one.folders[0].id, added.id]);
    expect(view.files.filter((f) => f.folderId === added.id).map((f) => f.path)).toEqual([path.join(dir, 'a.jpg')]);
    expect(view.files).toHaveLength(2);
    const fresh = openStorage({ location: { file: storageFile } });
    expect(fresh.getCollection(one.collection.id).folderIds).toEqual(view.collection.folderIds);
    expect(fresh.getIndex({ folderId: added.id })).toHaveLength(1);
  });

  it('rejects relative, file, missing and non-listable paths naming the folder, store unchanged', async () => {
    const { svc, calls, one, base } = await setup({ confirm: () => true });
    const file = path.join(base, 'f.txt');
    fs.writeFileSync(file, 'x');
    const missing = path.join(work, 'nope');
    const locked = mk('locked');
    const realOpendir = fs.promises.opendir;
    const spy = vi.spyOn(fs.promises, 'opendir').mockImplementation((p, ...rest) =>
      p === locked
        ? Promise.reject(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }))
        : realOpendir.call(fs.promises, p, ...rest));
    try {
      const before = raw();
      await expect(svc.addFolder(one.collection.id, 'relative/dir')).rejects.toThrow(/absolute.*relative\/dir/);
      await expect(svc.addFolder(one.collection.id, file)).rejects.toThrow(new RegExp(`Not a directory: ${file}`));
      await expect(svc.addFolder(one.collection.id, missing)).rejects.toThrow(new RegExp(`${missing}`));
      await expect(svc.addFolder(one.collection.id, locked)).rejects.toThrow(new RegExp(`${locked} \\(EPERM\\)`));
      expect(raw()).toBe(before);
      expect(calls.scans).toEqual([]);
      expect(calls.writes).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a directory that contains the storage file, as creation does', async () => {
    const { svc, calls, one } = await setup({ confirm: () => true });
    const before = raw();
    await expect(svc.addFolder(one.collection.id, work)).rejects.toThrow(/storage location/);
    await expect(svc.addFolder(one.collection.id, path.dirname(storageFile))).rejects.toThrow(/storage location/);
    expect(raw()).toBe(before);
    expect(calls.scans).toEqual([]);
  });

  it('rejects an unknown collection', async () => {
    const { svc, calls } = await setup({ confirm: () => true });
    await expect(svc.addFolder('nope', mk('x'))).rejects.toThrow(/Unknown collection/);
    expect(calls.scans).toEqual([]);
  });

  async function expectRefused(ctx, dirPath, wording, shown) {
    const { svc, calls, one } = ctx;
    const before = raw();
    const err = await svc.addFolder(one.collection.id, dirPath).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('FOLDER_COVERED');
    expect(err.message).toContain(wording);
    expect(err.message).toContain(shown);
    expect(calls.confirms.length).toBe(0);
    expect(calls.scans).toEqual([]);
    expect(calls.writes).toBe(0);
    expect(raw()).toBe(before);
  }

  it('a folder inside an existing one is refused: FOLDER_COVERED, "already covered" and the path, nothing asked, scanned or written', async () => {
    const ctx = await setup({ confirm: () => true });
    await expectRefused(ctx, mk('base', 'inner'), 'already covered', ctx.base);
  });

  it('an identical path is refused as already in the collection, also with a trailing slash and a different case', async () => {
    const ctx = await setup({ confirm: () => true });
    await expectRefused(ctx, ctx.base, 'already in the collection', ctx.base);
    await expectRefused(ctx, ctx.base + '/', 'already in the collection', ctx.base);
    await expectRefused(ctx, path.join(path.dirname(ctx.base), 'BASE'), 'already in the collection', ctx.base);
  });

  it('a symlink to an existing folder is refused as already in the collection', async () => {
    const ctx = await setup({ confirm: () => true });
    const link = path.join(work, 'link');
    fs.symlinkSync(ctx.base, link);
    await expectRefused(ctx, link, 'already in the collection', ctx.base);
  });

  it('without an injected confirm an inside add is still refused', async () => {
    const storage = openStorage({ location: { file: storageFile } });
    const svc = createCollectionService({ storage, scan: stubScan });
    const created = await svc.createCollection('One', [mk('base')]);
    const err = await svc.addFolder(created.collection.id, mk('base', 'inner')).catch((e) => e);
    expect(err.code).toBe('FOLDER_COVERED');
  });

  it('refuses a candidate inside one folder that also contains another (legacy nesting): inside wins', async () => {
    const ctx = await setup({ confirm: () => true });
    const mid = mk('base', 'mid');
    const deep = mk('base', 'mid', 'deep');
    // Legacy data: nested roots written straight to the store, as the old confirm-and-keep-both add did.
    ctx.storage.transaction(() => {
      ctx.storage.putFolder({ id: 'legacy', collectionId: ctx.one.collection.id, path: deep, unavailable: false });
      ctx.storage.putCollection({ ...ctx.storage.getCollection(ctx.one.collection.id), folderIds: [ctx.one.folders[0].id, 'legacy'] });
    });
    ctx.calls.writes = 0;
    await expectRefused(ctx, mid, 'already covered', ctx.base);
  });

  // Collection "One" holds `base`; adds outer/inner1 and outer/inner2 and a sibling `keep` for the replace cases.
  async function withContained(opts = {}) {
    const ctx = await setup(opts);
    const inner1 = mk('outer', 'inner1');
    const inner2 = mk('outer', 'inner2');
    const keep = mk('keep');
    let view = ctx.one;
    for (const d of [inner1, inner2, keep]) view = await ctx.svc.addFolder(ctx.one.collection.id, d);
    ctx.calls.writes = 0;
    ctx.calls.scans.length = 0;
    return { ...ctx, inner1, inner2, keep, outer: path.join(work, 'outer'), view };
  }

  it('a folder containing one existing folder asks once, before any scan, naming it, with "will be replaced" and the label', async () => {
    const { svc, calls, one } = await setup({ confirm: () => true });
    const inner = mk('outer', 'inner');
    await svc.addFolder(one.collection.id, inner);
    calls.scans.length = 0;
    const outer = path.join(work, 'outer');
    const view = await svc.addFolder(one.collection.id, outer);
    expect(calls.confirms.length).toBe(1);
    const req = calls.confirms[0];
    expect(Object.keys(req).sort()).toEqual(['confirmLabel', 'detail', 'message', 'title']);
    expect(req.confirmLabel).toBe('Replace folders');
    expect(req.detail).toContain(inner);
    expect(req.detail).toContain('will be replaced');
    expect(calls.scans).toEqual([outer]);
    expect(view.replaced).toEqual([inner]);
  });

  it('asks before the scan runs', async () => {
    const order = [];
    const { svc, one } = await setup({
      confirm: () => { order.push('confirm'); return true; },
      scan: async (d) => { order.push('scan'); return stubScan(d); },
    });
    await svc.addFolder(one.collection.id, mk('outer', 'inner'));
    order.length = 0;
    await svc.addFolder(one.collection.id, path.join(work, 'outer'));
    expect(order).toEqual(['confirm', 'scan']);
  });

  it('confirm true leaves the new folder in place of the contained one: index, access data and folderIds cleaned, one scan, one write', async () => {
    const { svc, calls, one, base, inner1, inner2, keep, outer } = await withContained({ confirm: () => true });
    const before = openStorage({ location: { file: storageFile } });
    const oldIds = before.getCollection(one.collection.id).folderIds;
    const innerIds = before.listFolders(one.collection.id).filter((f) => [inner1, inner2].includes(f.path)).map((f) => f.id);
    const view = await svc.addFolder(one.collection.id, outer);
    expect(calls.scans).toEqual([outer]);
    expect(calls.writes).toBe(1);
    expect(view.replaced.sort()).toEqual([inner1, inner2].sort());
    expect(view.folders.map((f) => f.path).sort()).toEqual([base, keep, outer].sort());
    const added = view.folders.find((f) => f.path === outer);
    expect(view.collection.folderIds).toEqual([...oldIds.filter((id) => !innerIds.includes(id)), added.id]);
    const fresh = openStorage({ location: { file: storageFile } });
    expect(fresh.getCollection(one.collection.id).folderIds).toEqual(view.collection.folderIds);
    expect(fresh.getIndex({ folderId: added.id })).toHaveLength(1);
    for (const id of innerIds) {
      expect(fresh.getFolder(id)).toBeFalsy();
      expect(fresh.getIndex({ folderId: id })).toEqual([]);
    }
    expect(raw()).not.toContain(inner1);
    expect(raw()).not.toContain(inner2);
  });

  it('keeps an existing folder that is not contained when replacing two of three', async () => {
    const { svc, one, base, keep, outer } = await withContained({ confirm: () => true });
    const view = await svc.addFolder(one.collection.id, outer);
    expect(view.folders.map((f) => f.path)).toContain(keep);
    expect(view.folders.map((f) => f.path)).toContain(base);
    expect(view.folders).toHaveLength(3);
  });

  it('replacing every folder of the collection is allowed (no LAST_FOLDER)', async () => {
    const { svc, calls } = await setup({ confirm: () => true });
    const sole = mk('sole', 'child');
    const created = await svc.createCollection('Solo', [sole]);
    calls.scans.length = 0;
    const parent = path.join(work, 'sole');
    const view = await svc.addFolder(created.collection.id, parent);
    expect(view.folders.map((f) => f.path)).toEqual([parent]);
    expect(view.replaced).toEqual([sole]);
    expect(view.collection.folderIds).toEqual([view.folders[0].id]);
    expect(view.files).toHaveLength(1);
  });

  it('leaves another collection holding the same path byte-identical after a replace', async () => {
    const { svc, other, one, inner1, outer } = await withContained({ confirm: () => true });
    await svc.addFolder(other.collection.id, inner1);
    const snapshot = () => {
      const s = openStorage({ location: { file: storageFile } });
      const id = other.collection.id;
      return JSON.stringify({
        collection: s.getCollection(id),
        folders: s.listFolders(id),
        index: s.getIndex({ collectionId: id }),
      });
    };
    const before = snapshot();
    await svc.addFolder(one.collection.id, outer);
    expect(snapshot()).toBe(before);
  });

  it('confirm false resolves canceled with no scan, no write and an unchanged store', async () => {
    const { svc, calls, one, outer } = await withContained({ confirm: () => false });
    const before = raw();
    await expect(svc.addFolder(one.collection.id, outer)).resolves.toEqual({ canceled: true });
    expect(calls.confirms.length).toBe(1);
    expect(calls.scans).toEqual([]);
    expect(calls.writes).toBe(0);
    expect(raw()).toBe(before);
  });

  it('without an injected confirm a containing add is canceled', async () => {
    const calls = { scans: 0 };
    const storage = openStorage({ location: { file: storageFile } });
    const svc = createCollectionService({ storage, scan: async (d) => { calls.scans += 1; return stubScan(d); } });
    const created = await svc.createCollection('One', [mk('outer', 'inner')]);
    calls.scans = 0;
    const before = raw();
    await expect(svc.addFolder(created.collection.id, path.join(work, 'outer'))).resolves.toEqual({ canceled: true });
    expect(calls.scans).toBe(0);
    expect(raw()).toBe(before);
  });

  it('a failure inside the replace transaction (removeFolder throws) leaves the store unchanged in memory and on disk', async () => {
    let failing = false;
    const { svc, guard, storage, one, outer } = await withContained({
      confirm: () => true,
      wrap: (s) => ({
        ...s,
        removeFolder(...args) {
          if (failing) throw new Error('injected');
          return s.removeFolder(...args);
        },
      }),
    });
    const before = raw();
    const memBefore = JSON.stringify(storage.getCollection(one.collection.id)) + JSON.stringify(storage.listFolders(one.collection.id));
    failing = true;
    await expect(svc.addFolder(one.collection.id, outer)).rejects.toThrow('injected');
    expect(raw()).toBe(before);
    expect(JSON.stringify(storage.getCollection(one.collection.id)) + JSON.stringify(storage.listFolders(one.collection.id))).toBe(memBefore);
    expect(guard.isBusy(one.collection.id)).toBe(false);
  });

  it('a new folder whose scan fails is stored unavailable with an empty index, and the contained folders are still replaced', async () => {
    let failScan = false;
    const { svc, one, outer, inner1 } = await withContained({
      confirm: () => true,
      scan: async (d) => { if (failScan) throw new Error('drive gone'); return stubScan(d); },
    });
    failScan = true;
    const view = await svc.addFolder(one.collection.id, outer);
    const added = view.folders.find((f) => f.path === outer);
    expect(added.unavailable).toBe(true);
    expect(view.files.filter((f) => f.folderId === added.id)).toEqual([]);
    expect(view.folders.map((f) => f.path)).not.toContain(inner1);
    expect(view.replaced).toContain(inner1);
  });

  it('releases the guard after a refusal, a cancel and a failure', async () => {
    const refused = await setup({ confirm: () => true });
    await refused.svc.addFolder(refused.one.collection.id, mk('base', 'inner')).catch(() => {});
    expect(refused.guard.isBusy(refused.one.collection.id)).toBe(false);
    const canceled = await withContained({ confirm: () => false });
    await canceled.svc.addFolder(canceled.one.collection.id, canceled.outer);
    expect(canceled.guard.isBusy(canceled.one.collection.id)).toBe(false);
    const failed = await withContained({ confirm: () => { throw new Error('dialog failed'); } });
    await failed.svc.addFolder(failed.one.collection.id, failed.outer).catch(() => {});
    expect(failed.guard.isBusy(failed.one.collection.id)).toBe(false);
  });

  it('a path with no overlap does not call confirm', async () => {
    const { svc, calls, one } = await setup({ confirm: () => true });
    await svc.addFolder(one.collection.id, mk('base-sibling'));
    expect(calls.confirms.length).toBe(0);
  });

  it('the same path added to a second collection is a separate record with its own index', async () => {
    const { svc, calls, one, other, base } = await setup({ confirm: () => true });
    const firstBefore = JSON.stringify(svc.getCollectionView(one.collection.id));
    const view = await svc.addFolder(other.collection.id, base);
    expect(calls.confirms.length).toBe(0);
    const added = view.folders.find((f) => f.path === base);
    expect(added.id).not.toBe(one.folders[0].id);
    expect(added.collectionId).toBe(other.collection.id);
    const fresh = openStorage({ location: { file: storageFile } });
    expect(fresh.getIndex({ folderId: added.id })).toHaveLength(1);
    expect(JSON.stringify(svc.getCollectionView(one.collection.id))).toBe(firstBefore);
    expect(JSON.stringify(openStorage({ location: { file: storageFile } }).getIndex({ folderId: one.folders[0].id })))
      .toBe(JSON.stringify(fresh.getIndex({ folderId: one.folders[0].id })));
  });

  it('holds the guard during the scan, excludes the other operations and releases afterwards', async () => {
    let finish;
    const gate = new Promise((r) => { finish = r; });
    let slow = false;
    const { svc, guard, calls, one, other } = await setup({
      confirm: () => true,
      scan: async (d) => { if (slow) await gate; return stubScan(d); },
    });
    slow = true;
    const adding = svc.addFolder(one.collection.id, mk('new'));
    await vi.waitFor(() => expect(calls.scans.length).toBe(1));
    expect(guard.holder(one.collection.id)).toBe('add-folder');
    const rescan = createRescanService({ storage: openStorage({ location: { file: storageFile } }), scan: stubScan, guard });
    const errs = await Promise.all([
      svc.renameCollection(one.collection.id, 'X').catch((e) => e),
      svc.deleteCollection(one.collection.id).catch((e) => e),
      svc.removeFolder(one.collection.id, one.folders[0].id).catch((e) => e),
      rescan.rescanCollection(one.collection.id).catch((e) => e),
      svc.addFolder(one.collection.id, mk('again')).catch((e) => e),
    ]);
    for (const e of errs) expect(e.code).toBe('COLLECTION_BUSY');
    await expect(svc.renameCollection(other.collection.id, 'Y')).resolves.toBeTruthy();
    finish();
    await expect(adding).resolves.toBeTruthy();
    expect(guard.isBusy(one.collection.id)).toBe(false);
    await expect(svc.renameCollection(one.collection.id, 'X')).resolves.toBeTruthy();
  });

  it('holds the guard while confirm is pending', async () => {
    let answer;
    const pending = new Promise((r) => { answer = r; });
    const { svc, guard, calls, one, outer } = await withContained({ confirm: () => pending });
    const adding = svc.addFolder(one.collection.id, outer);
    await vi.waitFor(() => expect(calls.confirms.length).toBe(1));
    expect(guard.holder(one.collection.id)).toBe('add-folder');
    const rescan = createRescanService({ storage: openStorage({ location: { file: storageFile } }), scan: stubScan, guard });
    const err = await rescan.rescanCollection(one.collection.id).catch((e) => e);
    expect(err.code).toBe('COLLECTION_BUSY');
    expect(calls.scans).toEqual([]);
    answer(false);
    await expect(adding).resolves.toEqual({ canceled: true });
    expect(guard.isBusy(one.collection.id)).toBe(false);
  });

  it('a busy add neither scans nor asks', async () => {
    const { svc, guard, calls, one } = await setup({ confirm: () => true });
    const release = guard.acquire(one.collection.id, 'rescan');
    const before = raw();
    const err = await svc.addFolder(one.collection.id, mk('base', 'inner')).catch((e) => e);
    expect(err.code).toBe('COLLECTION_BUSY');
    expect(calls.scans).toEqual([]);
    expect(calls.confirms.length).toBe(0);
    expect(raw()).toBe(before);
    expect(guard.holder(one.collection.id)).toBe('rescan');
    release();
  });

  it('a scan failure after the readability check stores unavailable: true with an empty index and releases the guard', async () => {
    const { svc, guard, one } = await setup({
      confirm: () => true,
      scan: async () => { throw new Error('drive gone'); },
    });
    const dir = mk('new');
    const view = await svc.addFolder(one.collection.id, dir);
    const added = view.folders.find((f) => f.path === dir);
    expect(added.unavailable).toBe(true);
    expect(view.files.filter((f) => f.folderId === added.id)).toEqual([]);
    expect(view.collection.folderIds).toContain(added.id);
    expect(openStorage({ location: { file: storageFile } }).getIndex({ folderId: added.id })).toEqual([]);
    expect(guard.isBusy(one.collection.id)).toBe(false);
  });

  it('a failure inside the transaction leaves the store unchanged and releases the guard', async () => {
    let failing = false;
    const { svc, guard, one } = await setup({
      confirm: () => true,
      wrap: (s) => ({
        ...s,
        replaceFolderIndex(...args) {
          if (failing) throw new Error('injected');
          return s.replaceFolderIndex(...args);
        },
      }),
    });
    const before = raw();
    failing = true;
    await expect(svc.addFolder(one.collection.id, mk('new'))).rejects.toThrow('injected');
    expect(raw()).toBe(before);
    const fresh = openStorage({ location: { file: storageFile } });
    expect(fresh.listFolders(one.collection.id)).toHaveLength(1);
    expect(fresh.getCollection(one.collection.id).folderIds).toEqual([one.folders[0].id]);
    expect(guard.isBusy(one.collection.id)).toBe(false);
  });
});

describe('addFolders', () => {
  const mk = (...parts) => {
    const d = path.join(work, ...parts);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  async function setup(confirm) {
    const scans = [];
    const confirms = [];
    const storage = openStorage({ location: { file: storageFile } });
    const svc = createCollectionService({
      storage,
      scan: async (dir) => { scans.push(dir); return stubScan(dir); },
      confirm: async (req) => { confirms.push(req); return confirm ? confirm(req) : true; },
    });
    const base = mk('base');
    const one = await svc.createCollection('One', [base]);
    scans.length = 0;
    return { svc, storage, scans, confirms, base, id: one.collection.id };
  }

  for (const [label, order] of [['outer first', ['a', 'a/b']], ['inner first', ['a/b', 'a']]]) {
    it(`picks /a and /a/b (${label}): one folder is added, /a/b is dropped, nothing is asked or refused`, async () => {
      const { svc, storage, scans, confirms, id } = await setup();
      const a = mk('a');
      const ab = mk('a', 'b');
      const result = await svc.addFolders(id, order.map((o) => path.join(work, o)));
      expect(storage.listFolders(id).map((f) => f.path)).toEqual([path.join(work, 'base'), a]);
      expect(scans).toEqual([a]);
      expect(confirms).toEqual([]);
      expect(result.dropped).toEqual([{ path: ab, coveredBy: a }]);
      expect(result.notice).toContain(ab);
      expect(result.replaced).toEqual([]);
      expect(result.view.folders.map((f) => f.path)).toEqual([path.join(work, 'base'), a]);
    });
  }

  it('adds the picks in order and returns notice null when nothing was dropped or replaced', async () => {
    const { svc, storage, id } = await setup();
    const x = mk('x');
    const y = mk('y');
    const result = await svc.addFolders(id, [y, x]);
    expect(storage.listFolders(id).map((f) => f.path)).toEqual([path.join(work, 'base'), y, x]);
    expect(result).toMatchObject({ replaced: [], dropped: [], notice: null });
  });

  it('a refusal stops the rest and carries the view so far; the first pick stays', async () => {
    const { svc, storage, base, id } = await setup();
    const x = mk('x');
    const z = mk('z');
    const err = await svc.addFolders(id, [x, mk('base', 'inner'), z]).catch((e) => e);
    expect(err.code).toBe('FOLDER_COVERED');
    expect(err.partial.view.folders.map((f) => f.path)).toEqual([base, x]);
    expect(storage.listFolders(id).map((f) => f.path)).toEqual([base, x]);
  });

  it('a confirmed replace is listed in replaced and in the notice; a cancelled one adds nothing', async () => {
    for (const answer of [true, false]) {
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      const { svc, storage, confirms, id } = await setup(() => answer);
      const outer = mk('outer');
      const inner = mk('outer', 'inner');
      await svc.addFolder(id, inner);
      confirms.length = 0;
      const result = await svc.addFolders(id, [outer]);
      expect(confirms).toHaveLength(1);
      if (answer) {
        expect(result.replaced).toEqual([inner]);
        expect(result.notice).toBe(`${outer} replaced ${inner}.`);
        expect(storage.listFolders(id).map((f) => f.path)).toContain(outer);
      } else {
        expect(result).toMatchObject({ view: null, replaced: [], notice: null });
        expect(storage.listFolders(id).map((f) => f.path)).toEqual([path.join(work, 'base'), inner]);
      }
    }
  });

  it('releases the guard and refuses a second concurrent add with COLLECTION_BUSY', async () => {
    const { svc, id } = await setup();
    const first = svc.addFolders(id, [mk('m')]);
    const second = await svc.addFolder(id, mk('n')).catch((e) => e);
    expect(second.code).toBe('COLLECTION_BUSY');
    await first;
    await expect(svc.addFolders(id, [mk('o')])).resolves.toMatchObject({ dropped: [] });
  });
});

describe('createCollection drops nested picks', () => {
  const mk = (...parts) => {
    const d = path.join(work, ...parts);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  function setup({ confirm, wrap = (s) => s } = {}) {
    const calls = { scans: [], confirms: [], writes: 0 };
    const scan = async (dir) => {
      calls.scans.push(dir);
      return stubScan(dir);
    };
    const storage = wrap(openStorage({
      location: { file: storageFile },
      fs: { renameSync(a, b) { calls.writes += 1; return fs.renameSync(a, b); } },
    }));
    const svc = createCollectionService({
      storage,
      scan,
      confirm: confirm && (async (req) => { calls.confirms.push(req); return confirm(req); }),
    });
    return { svc, calls };
  }
  const stored = () => openStorage({ location: { file: storageFile } });

  it('keeps the outer pick, scans only it, and reports the inner one with its covering folder', async () => {
    const outer = mk('m', 'a');
    const inner = mk('m', 'a', 'b');
    const { svc, calls } = setup();
    const view = await svc.createCollection('C', [outer, inner]);
    expect(view.folders.map((f) => f.path)).toEqual([outer]);
    expect(calls.scans).toEqual([outer]);
    expect(view.dropped).toEqual([{ path: inner, coveredBy: outer }]);
    expect(stored().listFolders(view.collection.id).map((f) => f.path)).toEqual([outer]);
    expect(view.collection.folderIds).toEqual([view.folders[0].id]);
  });

  it('gives the same result when the inner pick is given first', async () => {
    const outer = mk('m', 'a');
    const inner = mk('m', 'a', 'b');
    const { svc, calls } = setup();
    const view = await svc.createCollection('C', [inner, outer]);
    expect(view.folders.map((f) => f.path)).toEqual([outer]);
    expect(calls.scans).toEqual([outer]);
    expect(view.dropped).toEqual([{ path: inner, coveredBy: outer }]);
  });

  it('three picks with two nested pairs report both dropped folders with their covering folders', async () => {
    const a = mk('a');
    const a1 = mk('a', 'one');
    const x = mk('x');
    const x1 = mk('x', 'one');
    const { svc } = setup();
    const view = await svc.createCollection('C', [a, a1, x, x1]);
    expect(view.folders.map((f) => f.path)).toEqual([a, x]);
    expect(view.dropped).toEqual([{ path: a1, coveredBy: a }, { path: x1, coveredBy: x }]);
  });

  it('unrelated picks keep every folder and report nothing dropped', async () => {
    const x = mk('x');
    const y = mk('y');
    const { svc } = setup();
    const view = await svc.createCollection('C', [x, y]);
    expect(view.folders.map((f) => f.path)).toEqual([x, y]);
    expect(view.dropped).toEqual([]);
  });

  it('duplicates that collapse after path.resolve are not reported as dropped', async () => {
    const x = mk('x');
    const { svc } = setup();
    const view = await svc.createCollection('C', [x, x, path.join(x, '..', 'x')]);
    expect(view.folders).toHaveLength(1);
    expect(view.dropped).toEqual([]);
  });

  it('never calls confirm at creation, even when one is injected', async () => {
    const outer = mk('outer');
    const inner = mk('outer', 'inner');
    const { svc, calls } = setup({ confirm: () => false });
    const view = await svc.createCollection('C', [outer, inner]);
    expect(view.folders).toHaveLength(1);
    expect(calls.confirms).toEqual([]);
  });

  it('drops a pick that is a symlink to another pick and reports it', async () => {
    const target = mk('target');
    const link = path.join(work, 'link');
    fs.symlinkSync(target, link);
    const { svc, calls } = setup();
    const view = await svc.createCollection('C', [target, link]);
    expect(view.folders.map((f) => f.path)).toEqual([target]);
    expect(calls.scans).toEqual([target]);
    expect(view.dropped).toEqual([{ path: link, coveredBy: target }]);
  });

  it('the same folder in two separate collections is accepted', async () => {
    const x = mk('x');
    const { svc } = setup();
    const first = await svc.createCollection('A', [x]);
    const second = await svc.createCollection('B', [x]);
    expect(first.dropped).toEqual([]);
    expect(second.dropped).toEqual([]);
    expect(stored().listCollections()).toHaveLength(2);
  });

  it('a dropped pick that is not a readable directory still rejects the whole creation', async () => {
    const outer = mk('outer');
    const { svc, calls } = setup();
    await expect(svc.createCollection('C', [outer, path.join(outer, 'missing')])).rejects.toThrow(/missing/);
    expect(calls.scans).toEqual([]);
    expect(stored().listCollections()).toEqual([]);
  });

  it('writes the store once', async () => {
    const outer = mk('outer');
    const inner = mk('outer', 'inner');
    const { svc, calls } = setup();
    await svc.createCollection('C', [outer, inner]);
    expect(calls.writes).toBe(1);
  });
});

describe('collection view order and resolvedPath', () => {
  const mk = (...parts) => {
    const d = path.join(work, ...parts);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const rec = (id, p) => ({ id, collectionId: 'c', path: p, unavailable: false });

  // Folders are put before the collection, so putFolder does not touch folderIds.
  function seed(folders, folderIds, extraIndex = {}) {
    const storage = openStorage({ location: { file: storageFile } });
    for (const f of folders) storage.putFolder(f);
    storage.putCollection({ id: 'c', name: 'C', folderIds, createdAt: '2026-01-01T00:00:00.000Z' });
    storage.replaceFolderIndex('fa', [{ path: path.join(folders[0].path, 'a.jpg'), relativePath: 'a.jpg', name: 'a.jpg', extension: 'jpg', kind: 'image' }]);
    for (const [id, files] of Object.entries(extraIndex)) storage.replaceFolderIndex(id, files);
    seeded = storage;
    return createCollectionService({ storage, scan: throwingScan });
  }
  let seeded;

  it('returns folders in folderIds order regardless of insertion order', () => {
    const svc = seed([rec('fa', mk('a')), rec('fb', mk('b')), rec('fc', mk('c'))], ['fc', 'fa', 'fb']);
    expect(svc.getCollectionView('c').folders.map((f) => f.id)).toEqual(['fc', 'fa', 'fb']);
  });

  it('puts a folder missing from folderIds after the listed ones, unlisted ones by id', () => {
    const svc = seed(
      [rec('fa', mk('a')), rec('fz', mk('z')), rec('fb', mk('b')), rec('fy', mk('y'))],
      ['fb', 'fa']);
    expect(svc.getCollectionView('c').folders.map((f) => f.id)).toEqual(['fb', 'fa', 'fy', 'fz']);
  });

  it('ignores folderIds entries with no folder record and lists a repeated id once', () => {
    const svc = seed([rec('fa', mk('a')), rec('fb', mk('b'))], ['ghost', 'fb', 'fb', 'fa']);
    expect(svc.getCollectionView('c').folders.map((f) => f.id)).toEqual(['fb', 'fa']);
  });

  it('resolvedPath is the realpath for an existing folder, including a symlink', () => {
    const real = mk('real');
    const link = path.join(work, 'link');
    fs.symlinkSync(real, link);
    const svc = seed([rec('fa', real), rec('fb', link)], ['fa', 'fb']);
    const [a, b] = svc.getCollectionView('c').folders;
    expect(a.resolvedPath).toBe(fs.realpathSync(real));
    expect(b.path).toBe(link);
    expect(b.resolvedPath).toBe(fs.realpathSync(link));
    expect(b.resolvedPath).toBe(fs.realpathSync(real));
  });

  it('resolvedPath is path for a folder that does not exist', () => {
    const gone = path.join(work, 'gone');
    const svc = seed([rec('fa', gone)], ['fa']);
    expect(svc.getCollectionView('c').folders[0].resolvedPath).toBe(gone);
  });

  it('never writes resolvedPath to the store', () => {
    const svc = seed([rec('fa', mk('a')), rec('fb', path.join(work, 'gone'))], ['fa', 'fb']);
    const before = fs.readFileSync(storageFile, 'utf8');
    svc.getCollectionView('c');
    expect(fs.readFileSync(storageFile, 'utf8')).toBe(before);
    expect(before).not.toContain('resolvedPath');
    const reopened = openStorage({ location: { file: storageFile } });
    expect(reopened.listFolders('c').every((f) => !('resolvedPath' in f))).toBe(true);
  });

  it('the rescan view carries the same fields; files and unavailable are unchanged', async () => {
    const { createRescanService } = require('../../src/main/collections/rescan.js');
    const a = mk('a');
    const xFile = { path: path.join(work, 'gone', 'x.jpg'), relativePath: 'x.jpg', name: 'x.jpg', extension: 'jpg', kind: 'image' };
    const svc = seed([rec('fa', a), { ...rec('fb', path.join(work, 'gone')), unavailable: true }], ['fb', 'fa'], { fb: [xFile] });
    const storage = seeded;
    const view = svc.getCollectionView('c');
    expect(view.files.map((f) => [f.folderId, f.name, f.unavailable])).toEqual([
      ['fb', 'x.jpg', true],
      ['fa', 'a.jpg', undefined],
    ]);
    expect('unavailable' in view.files[1]).toBe(false);
    const rescan = createRescanService({ storage, scan: async () => [] });
    const result = await rescan.rescanCollection('c');
    expect(result.folders.map((f) => [f.id, f.resolvedPath])).toEqual([
      ['fb', path.join(work, 'gone')],
      ['fa', fs.realpathSync(a)],
    ]);
  });
});
