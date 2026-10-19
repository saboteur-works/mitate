import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const require = createRequire(import.meta.url);
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');
const { createRescanService } = require('../../src/main/collections/rescan.js');
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
    const id = created.folders[0].id;
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
