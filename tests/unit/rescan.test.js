import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');
const { createRescanService } = require('../../src/main/collections/rescan.js');
const { createInFlightGuard } = require('../../src/main/collections/in-flight.js');
const { runScan } = require('../../src/main/discovery/run-scan.js');
const readonly = require('../../tools/readonly-check/index.js');

let fixture;
let work;
let storage;

beforeEach(() => {
  fixture = buildFixtureTree();
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mo-rescan-')));
  storage = openStorage({ location: { file: path.join(work, 'app-data', 'store.json') } });
});
afterEach(() => {
  cleanupFixtureTree(fixture.root);
  fs.rmSync(work, { recursive: true, force: true });
});

const names = (view) => view.files.map((f) => f.relativePath).sort();
const create = (dirs) => createCollectionService({ storage, scan: runScan }).createCollection('c', dirs);

describe('rescanCollection', () => {
  it('shows an added file and drops a deleted one', async () => {
    const photos = path.join(fixture.root, 'Photos');
    const created = await create([photos]);
    expect(names(created)).toContain('A.JPG');
    fs.writeFileSync(path.join(photos, 'added-later.jpg'), 'x');
    fs.rmSync(path.join(photos, 'A.JPG'));

    const result = await createRescanService({ storage }).rescanCollection(created.collection.id);
    expect(names(result)).toContain('added-later.jpg');
    expect(names(result)).not.toContain('A.JPG');
    expect(result.summary).toEqual({ rescanned: [created.folders[0].id], skipped: [] });
    const stored = storage.getIndex({ collectionId: created.collection.id }).map((f) => f.relativePath);
    expect(stored).toContain('added-later.jpg');
    expect(stored).not.toContain('A.JPG');
  });

  it('skips an unavailable folder, keeps its files, and still rescans the others', async () => {
    const gone = fs.mkdtempSync(path.join(work, 'gone-'));
    fs.writeFileSync(path.join(gone, 'keep.jpg'), 'x');
    const photos = path.join(fixture.root, 'Photos');
    const created = await create([gone, photos]);
    const goneId = created.folders.find((f) => f.path === gone).id;
    const photosId = created.folders.find((f) => f.path === photos).id;
    const storedBefore = storage.getIndex({ folderId: goneId });
    expect(storedBefore.length).toBe(1);

    fs.rmSync(gone, { recursive: true });
    fs.writeFileSync(path.join(photos, 'added-later.jpg'), 'x');

    const result = await createRescanService({ storage }).rescanCollection(created.collection.id);
    expect(result.summary).toEqual({ rescanned: [photosId], skipped: [goneId] });
    expect(result.folders.find((f) => f.id === goneId).unavailable).toBe(true);
    expect(storage.getIndex({ folderId: goneId })).toEqual(storedBefore);
    const goneFiles = result.files.filter((f) => f.folderId === goneId);
    expect(goneFiles.length).toBe(1);
    expect(goneFiles.every((f) => f.unavailable === true)).toBe(true);
    expect(names(result)).toContain('added-later.jpg');
  });

  it('marks a folder available again once it is back', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'back-'));
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    const created = await create([dir]);
    const id = created.folders[0].id;
    storage.setFolderUnavailable(id, true);

    const result = await createRescanService({ storage }).rescanCollection(created.collection.id);
    expect(result.summary.rescanned).toEqual([id]);
    expect(result.folders[0].unavailable).toBe(false);
    expect(result.files.every((f) => f.unavailable === undefined)).toBe(true);
  });

  it('clears the unavailable flag of a folder that was unavailable and scans successfully', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'clear-'));
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    const created = await create([dir]);
    const id = created.folders[0].id;
    storage.setFolderUnavailable(id, true);
    expect(storage.getFolder(id).unavailable).toBe(true);

    await createRescanService({ storage }).rescanCollection(created.collection.id);
    expect(storage.getFolder(id).unavailable).toBe(false);
  });

  // Scenario: the snapshot taken before the await says unavailable=false; while
  // the scan is awaited another operation marks the folder unavailable. The scan
  // then succeeds, so the decision must use the re-read state (unavailable=true)
  // and the final stored flag must be false. Deciding from the stale snapshot
  // would leave it true.
  it('decides whether to clear unavailable from the state re-read after the scan', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'race-'));
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    const created = await create([dir]);
    const id = created.folders[0].id;
    expect(storage.getFolder(id).unavailable).toBeFalsy();

    const scan = async (p) => {
      storage.setFolderUnavailable(id, true); // another operation, mid-scan
      return runScan(p);
    };
    const result = await createRescanService({ storage, scan }).rescanCollection(created.collection.id);
    expect(result.summary.rescanned).toEqual([id]);
    expect(storage.getFolder(id).unavailable).toBe(false);
    expect(result.folders[0].unavailable).toBe(false);
  });

  // Reverse: snapshot says unavailable=true, another operation clears it during
  // the scan; the re-read says available so no flag write is needed.
  it('does not write the flag when the re-read state is already available', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'race2-'));
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    const created = await create([dir]);
    const id = created.folders[0].id;
    storage.setFolderUnavailable(id, true);

    const scan = async (p) => {
      storage.setFolderUnavailable(id, false);
      return runScan(p);
    };
    const writes = [];
    const spy = { ...storage, setFolderUnavailable: (...a) => (writes.push(a), storage.setFolderUnavailable(...a)) };
    await createRescanService({ storage: spy, scan }).rescanCollection(created.collection.id);
    expect(writes).toEqual([]);
    expect(storage.getFolder(id).unavailable).toBe(false);
  });

  it('skips writing when the folder was removed from storage during the scan', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'removed-'));
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    const created = await create([dir]);
    const calls = [];
    const spy = {
      ...storage,
      getFolder: () => undefined,
      replaceFolderIndex: (...a) => calls.push(['replace', ...a]),
      setFolderUnavailable: (...a) => calls.push(['flag', ...a]),
    };
    const rescan = createRescanService({ storage: spy, scan: runScan });
    await rescan.rescanCollection(created.collection.id).catch(() => {});
    expect(calls).toEqual([]);
  });

  it('flags a folder unavailable and keeps its files when the scan rejects', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'fail-'));
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    const created = await create([dir]);
    const failing = async () => {
      throw new Error('boom');
    };
    const result = await createRescanService({ storage, scan: failing }).rescanCollection(created.collection.id);
    expect(result.summary).toEqual({ rescanned: [], skipped: [created.folders[0].id] });
    expect(result.folders[0].unavailable).toBe(true);
    expect(result.files.length).toBe(1);
  });

  it('rejects an unknown collection id', async () => {
    await expect(createRescanService({ storage }).rescanCollection('nope')).rejects.toThrow(/unknown collection/);
  });

  it('leaves the fixture tree unchanged around the rescan call', async () => {
    const created = await create([fixture.root]);
    fs.writeFileSync(path.join(fixture.root, 'Photos', 'added-later.jpg'), 'x');
    fs.rmSync(path.join(fixture.root, 'Photos', 'A.JPG'));
    const before = readonly.snapshot(fixture.root, { role: 'before' });
    await createRescanService({ storage }).rescanCollection(created.collection.id);
    const after = readonly.snapshot(fixture.root, { role: 'after' });
    expect(readonly.assert(before, after)).toBeDefined();
  });
});

describe('concurrent rescans (FR-20)', () => {
  function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
  }
  const folderWith = (prefix) => {
    const dir = fs.mkdtempSync(path.join(work, prefix));
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    return dir;
  };

  it('rejects a second rescan of the same collection while one is pending, without scanning again', async () => {
    const created = await create([folderWith('busy-')]);
    const id = created.collection.id;
    const gate = deferred();
    const calls = [];
    const scan = async (p) => {
      calls.push(p);
      await gate.promise;
      return runScan(p);
    };
    const rescan = createRescanService({ storage, scan });

    const first = rescan.rescanCollection(id);
    await vi.waitFor(() => expect(calls.length).toBe(1)); // first scan is now pending on the gate
    const second = await rescan.rescanCollection(id).catch((err) => err);
    expect(second).toBeInstanceOf(Error);
    expect(second.code).toBe('RESCAN_IN_PROGRESS');
    expect(calls.length).toBe(1);

    gate.resolve();
    const done = await first;
    expect(done.summary.rescanned.length).toBe(1);
    expect(calls.length).toBe(1);

    // The marker is cleared: a new rescan runs (gate is already open).
    const again = await rescan.rescanCollection(id);
    expect(again.summary.rescanned.length).toBe(1);
    expect(calls.length).toBe(2);
  });

  it('rejects with COLLECTION_BUSY, running no discovery, when the guard is held by add-folder', async () => {
    const created = await create([folderWith('held-')]);
    const id = created.collection.id;
    const guard = createInFlightGuard();
    const release = guard.acquire(id, 'add-folder');
    const calls = [];
    const scan = async (p) => { calls.push(p); return runScan(p); };
    const rescan = createRescanService({ storage, scan, guard });

    const err = await rescan.rescanCollection(id).catch((e) => e);
    expect(err.code).toBe('COLLECTION_BUSY');
    expect(err.message).toContain('add-folder');
    expect(calls.length).toBe(0);
    release();
    expect((await rescan.rescanCollection(id)).summary.rescanned.length).toBe(1);
  });

  it('holds the guard as kind rescan and releases it after success and after a failing scan', async () => {
    const created = await create([folderWith('rel-')]);
    const id = created.collection.id;
    const guard = createInFlightGuard();
    const gate = deferred();
    let fail = false;
    const scan = async (p) => {
      await gate.promise;
      if (fail) throw new Error('boom');
      return runScan(p);
    };
    const rescan = createRescanService({ storage, scan, guard });
    const pending = rescan.rescanCollection(id);
    await vi.waitFor(() => expect(guard.holder(id)).toBe('rescan'));
    gate.resolve();
    await pending;
    expect(guard.isBusy(id)).toBe(false);

    // A scan failure is reported as an unavailable folder; also cover a throwing storage.
    fail = true;
    await rescan.rescanCollection(id);
    expect(guard.isBusy(id)).toBe(false);
    const broken = { ...storage, listFolders: () => { throw new Error('storage down'); } };
    const failing = createRescanService({ storage: broken, scan, guard });
    await expect(failing.rescanCollection(id)).rejects.toThrow('storage down');
    expect(guard.isBusy(id)).toBe(false);
  });

  it('does not block a rescan of a different collection', async () => {
    const dirA = folderWith('a-');
    const a = await create([dirA]);
    const b = await create([folderWith('b-')]);
    const gate = deferred();
    const calls = [];
    // Gate by path: only collection A's folder waits. Which scan is called first
    // is not deterministic (each rescan awaits a readability check first).
    const scan = async (p) => {
      calls.push(p);
      if (path.basename(p) === path.basename(dirA)) await gate.promise;
      return runScan(p);
    };
    const rescan = createRescanService({ storage, scan });
    const first = rescan.rescanCollection(a.collection.id);
    const other = await rescan.rescanCollection(b.collection.id);
    expect(other.summary.rescanned.length).toBe(1);
    gate.resolve();
    await first;
    expect(calls.length).toBe(2);
  });

  it('clears the in-flight marker when the rescan fails', async () => {
    const created = await create([folderWith('fail-marker-')]);
    const id = created.collection.id;
    let broken = true;
    const spy = {
      ...storage,
      listFolders: (...a) => {
        if (broken) throw new Error('storage broke');
        return storage.listFolders(...a);
      },
    };
    const rescan = createRescanService({ storage: spy, scan: runScan });
    await expect(rescan.rescanCollection(id)).rejects.toThrow(/storage broke/);
    broken = false;
    const result = await rescan.rescanCollection(id);
    expect(result.summary.rescanned.length).toBe(1);
  });
});

describe('launch behaviour', () => {
  it('loadCollections shows the stored index and performs no discovery call', async () => {
    const dir = fs.mkdtempSync(path.join(work, 'launch-'));
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    await create([dir]);

    let calls = 0;
    const counting = async () => {
      calls += 1;
      throw new Error('scan must not be called');
    };
    const reopened = openStorage({ location: { file: storage.getLocation() } });
    const loaded = await createCollectionService({ storage: reopened, scan: counting }).loadCollections();
    expect(calls).toBe(0);
    expect(loaded[0].files.map((f) => f.name)).toEqual(['one.jpg']);
  });
});

describe('rescan writes the store once (FR-18)', () => {
  const { createCountingFs } = require('../support/counting-fs.js');

  function countingSetup() {
    const counter = createCountingFs();
    const counted = openStorage({
      location: { file: path.join(work, 'counted', 'store.json') },
      fs: counter.impl,
    });
    return { counter, counted };
  }
  const folderWith = (prefix) => {
    const dir = fs.mkdtempSync(path.join(work, prefix));
    fs.writeFileSync(path.join(dir, 'one.jpg'), 'x');
    return dir;
  };
  const createVia = (storage, dirs) =>
    createCollectionService({ storage, scan: runScan }).createCollection('c', dirs);

  it('rescans several folders (one with a flag change) in exactly one write', async () => {
    const { counter, counted } = countingSetup();
    const created = await createVia(counted, [folderWith('w1-'), folderWith('w2-'), folderWith('w3-')]);
    counted.setFolderUnavailable(created.folders[1].id, true);
    counter.reset();

    const result = await createRescanService({ storage: counted }).rescanCollection(created.collection.id);
    expect(result.summary.rescanned).toHaveLength(3);
    expect(counter.renames).toBe(1);
    expect(counted.getFolder(created.folders[1].id).unavailable).toBe(false);
    expect(fs.readdirSync(path.dirname(counted.getLocation()))).toEqual(['store.json']);
  });

  it('writes once when a skipped folder is newly flagged alongside a rescanned one', async () => {
    const { counter, counted } = countingSetup();
    const gone = folderWith('w4-');
    const created = await createVia(counted, [gone, folderWith('w5-')]);
    fs.rmSync(gone, { recursive: true });
    counter.reset();
    await createRescanService({ storage: counted }).rescanCollection(created.collection.id);
    expect(counter.renames).toBe(1);
  });

  it('writes nothing when every folder is skipped and no flag changes', async () => {
    const { counter, counted } = countingSetup();
    const gone = folderWith('w6-');
    const created = await createVia(counted, [gone]);
    fs.rmSync(gone, { recursive: true });
    counted.setFolderUnavailable(created.folders[0].id, true); // already flagged
    counter.reset();
    const result = await createRescanService({ storage: counted }).rescanCollection(created.collection.id);
    expect(result.summary.skipped).toEqual([created.folders[0].id]);
    expect(counter.renames).toBe(0);
  });

  it('writes nothing and keeps the stored file when applying the results fails', async () => {
    const { counter, counted } = countingSetup();
    const created = await createVia(counted, [folderWith('w7-'), folderWith('w8-')]);
    const before = fs.readFileSync(counted.getLocation());
    counter.reset();
    let n = 0;
    const flaky = {
      ...counted,
      replaceFolderIndex: (...a) => {
        if (++n === 2) throw new Error('index failed');
        return counted.replaceFolderIndex(...a);
      },
    };
    const id = created.collection.id;
    const svc = createRescanService({ storage: flaky });
    await expect(svc.rescanCollection(id)).rejects.toThrow('index failed');
    expect(counter.renames).toBe(0);
    expect(fs.readFileSync(counted.getLocation()).equals(before)).toBe(true);
    // a later rescan is not blocked by a leaked in-flight marker
    await expect(svc.rescanCollection(id)).resolves.toBeDefined();
  });
});

// Real unreadable folder (FR-4, FR-17, FR-20). chmod happens only on a folder
// inside the temp fixture copy built in beforeEach. Root bypasses mode bits, so
// the folder cannot be made unreadable there and the test is skipped.
const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe.skipIf(runningAsRoot)('rescan with a real unreadable folder (mode 000)', () => {
  const { lockFolder, unlockFolder } = require('../support/fixture-tree.js');
  const locked = () => path.join(fixture.root, 'Photos');
  const open = () => path.join(fixture.root, 'Docs');
  const music = () => path.join(fixture.root, 'Music');
  const state = () => {
    const s = fs.statSync(locked());
    return { mode: s.mode & 0o777, ino: s.ino, mtimeMs: s.mtimeMs, uid: s.uid };
  };

  afterEach(() => {
    // Inner hook runs before the outer afterEach removes the tree.
    unlockFolder(locked());
  });

  it('skips it, keeps its stored files, leaves it unavailable, and rescans the other folder', async () => {
    const created = await create([locked(), open()]);
    const lockedId = created.folders.find((f) => f.path === locked()).id;
    const openId = created.folders.find((f) => f.path === open()).id;
    const storedBefore = storage.getIndex({ folderId: lockedId });
    expect(storedBefore.length).toBeGreaterThan(0);

    fs.writeFileSync(path.join(open(), 'added-later.jpg'), 'x');
    lockFolder(locked());
    const stateBefore = state();
    const parentBefore = fs.readdirSync(fixture.root).sort();
    const docsBefore = readonly.snapshot(open(), { role: 'before' });
    const musicBefore = readonly.snapshot(music(), { role: 'before' });

    const result = await createRescanService({ storage }).rescanCollection(created.collection.id);
    expect(result.summary).toEqual({ rescanned: [openId], skipped: [lockedId] });
    expect(result.folders.find((f) => f.id === lockedId).unavailable).toBe(true);
    expect(storage.getFolder(lockedId).unavailable).toBe(true);
    expect(storage.getIndex({ folderId: lockedId })).toEqual(storedBefore);
    const keptFiles = result.files.filter((f) => f.folderId === lockedId);
    expect(keptFiles).toHaveLength(storedBefore.length);
    expect(keptFiles.every((f) => f.unavailable === true)).toBe(true);
    expect(names(result)).toContain('added-later.jpg');

    expect(readonly.assert(docsBefore, readonly.snapshot(open(), { role: 'after' }))).toBeDefined();
    expect(readonly.assert(musicBefore, readonly.snapshot(music(), { role: 'after' }))).toBeDefined();
    expect(state()).toEqual(stateBefore);
    expect(stateBefore.mode).toBe(0);
    expect(fs.readdirSync(fixture.root).sort()).toEqual(parentBefore);
  });
});
