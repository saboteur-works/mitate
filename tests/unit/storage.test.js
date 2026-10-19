import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const storageModule = require('../../src/main/storage/index.js');
const { openStorage, defaultStorageFile } = storageModule;

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const file = (base) => path.join(base, 'nested', 'store.json');

function populate(store, collectionFolder) {
  store.putCollection({ id: 'c1', name: 'Photos', folderIds: ['f1'], createdAt: '2026-10-18T00:00:00.000Z' });
  store.putFolder({ id: 'f1', collectionId: 'c1', path: collectionFolder });
  store.replaceFolderIndex('f1', [
    {
      path: `${collectionFolder}/a/b.jpg`,
      relativePath: 'a/b.jpg',
      name: 'b.jpg',
      extension: 'jpg',
      kind: 'image',
    },
  ]);
  store.setFolderAccess('f1', { kind: 'plain-path' });
}

describe('getIndex({ folderId })', () => {
  it('returns only that folder records', () => {
    const store = openStorage({ location: { file: file(dir) } });
    store.putCollection({ id: 'c1', name: 'C', folderIds: ['f1', 'f2', 'f3'], createdAt: '2026-10-18T00:00:00.000Z' });
    const rec = (d, n) => ({ path: `/${d}/${n}`, relativePath: n, name: n, extension: 'jpg', kind: 'image' });
    for (const id of ['f1', 'f2', 'f3']) store.putFolder({ id, collectionId: 'c1', path: `/${id}` });
    store.replaceFolderIndex('f1', [rec('f1', 'one.jpg'), rec('f1', 'two.jpg')]);
    store.replaceFolderIndex('f2', [rec('f2', 'three.jpg')]);
    expect(store.getIndex({ folderId: 'f1' }).map((r) => r.name)).toEqual(['one.jpg', 'two.jpg']);
    expect(store.getIndex({ folderId: 'f2' }).map((r) => r.name)).toEqual(['three.jpg']);
    expect(store.getIndex({ folderId: 'f3' })).toEqual([]);
    expect(store.getIndex({ folderId: 'nope' })).toEqual([]);
    expect(store.getIndex({ folderId: 'f1' }).every((r) => r.folderId === 'f1')).toBe(true);
  });
});

describe('storage persistence', () => {
  it('returns the same collections, folders, index and access after reopening', () => {
    const f = file(dir);
    const a = openStorage({ location: { file: f } });
    populate(a, '/media/photos');
    const b = openStorage({ location: { file: f } });
    expect(b.listCollections()).toHaveLength(1);
    expect(b.listCollections()).toEqual(a.listCollections());
    expect(b.listFolders()).toEqual(a.listFolders());
    expect(b.getIndex()).toEqual(a.getIndex());
    expect(b.getFolderAccess('f1')).toEqual({ kind: 'plain-path' });
    expect(b.getFolder('f1')).toEqual({ id: 'f1', collectionId: 'c1', path: '/media/photos', unavailable: false });
    expect(b.getIndex({ folderId: 'f1' })[0]).toMatchObject({
      folderId: 'f1',
      collectionId: 'c1',
      relativePath: 'a/b.jpg',
      kind: 'image',
    });
  });

  it('keeps the unavailable flag and the records when a folder is marked unavailable', () => {
    const f = file(dir);
    const a = openStorage({ location: { file: f } });
    populate(a, '/media/photos');
    a.setFolderUnavailable('f1', true);
    const b = openStorage({ location: { file: f } });
    expect(b.getFolder('f1').unavailable).toBe(true);
    expect(b.getIndex()).toHaveLength(1);
  });

  it('writes atomically and leaves no temp files', () => {
    const f = file(dir);
    const a = openStorage({ location: { file: f } });
    populate(a, '/media/photos');
    expect(fs.readdirSync(path.dirname(f))).toEqual(['store.json']);
  });

  it('removes a collection together with its folders, index and access data', () => {
    const a = openStorage({ location: { file: file(dir) } });
    populate(a, '/media/photos');
    a.removeCollection('c1');
    expect(a.listFolders()).toEqual([]);
    expect(a.getIndex()).toEqual([]);
    expect(a.getFolderAccess('f1')).toBeUndefined();
  });

  it('returns copies so callers cannot mutate stored state', () => {
    const a = openStorage({ location: { file: file(dir) } });
    populate(a, '/media/photos');
    a.getFolder('f1').path = '/changed';
    expect(a.getFolder('f1').path).toBe('/media/photos');
  });

  it('rejects invalid input', () => {
    const a = openStorage({ location: { file: file(dir) } });
    expect(() => a.putCollection({ id: 'c', name: '' })).toThrow();
    expect(() => a.putFolder({ id: 'f', collectionId: 'c', path: 'relative/p' })).toThrow();
    expect(() => a.replaceFolderIndex('missing', [])).toThrow(/unknown folder/);
    expect(() => openStorage({ location: { file: 'relative.json' } })).toThrow(/absolute/);
  });

  it('fails loudly on an unsupported store format', () => {
    const f = file(dir);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ version: 99 }));
    expect(() => openStorage({ location: { file: f } })).toThrow(/unsupported/);
  });
});

describe('storage location', () => {
  it('is set only through the config location entry', () => {
    const viaFile = openStorage({ location: { file: path.join(dir, 'x.json') } });
    expect(viaFile.getLocation()).toBe(path.join(dir, 'x.json'));
    const viaBase = openStorage({ location: { baseDir: dir } });
    expect(viaBase.getLocation()).toBe(path.join(dir, 'store.json'));
    viaBase.putCollection({ id: 'c', name: 'n' });
    expect(fs.existsSync(path.join(dir, 'store.json'))).toBe(true);
    // Other config keys do not move the store.
    const other = openStorage({ location: { baseDir: dir }, path: '/elsewhere/store.json', file: '/elsewhere/s.json' });
    expect(other.getLocation()).toBe(path.join(dir, 'store.json'));
  });

  it('defaults to a location outside any given collection folder', () => {
    const def = defaultStorageFile();
    expect(path.isAbsolute(def)).toBe(true);
    const collectionFolders = [dir, path.join(dir, 'photos'), os.tmpdir(), process.cwd()];
    for (const folder of collectionFolders) {
      const rel = path.relative(folder, def);
      expect(rel.startsWith('..') || path.isAbsolute(rel)).toBe(true);
    }
  });
});

describe('storage module surface', () => {
  it('exposes only functions (an API), no data or store contents', () => {
    expect(Object.keys(storageModule).sort()).toEqual(['defaultStorageFile', 'openStorage']);
    for (const value of Object.values(storageModule)) expect(typeof value).toBe('function');
    const store = openStorage({ location: { file: file(dir) } });
    for (const value of Object.values(store)) expect(typeof value).toBe('function');
  });
});

describe('storage.transaction (FR-18)', () => {
  const { createCountingFs } = require('../support/counting-fs.js');
  const open = (f, counter) => openStorage({ location: { file: f }, ...(counter ? { fs: counter.impl } : {}) });

  it('persists every mutation of the callback in exactly one write and survives reopening', () => {
    const f = file(dir);
    const counter = createCountingFs();
    const store = open(f, counter);
    store.transaction(() => populate(store, '/media/photos'));
    expect(counter.renames).toBe(1);
    const reopened = open(f);
    expect(reopened.listCollections()).toEqual(store.listCollections());
    expect(reopened.listFolders()).toEqual(store.listFolders());
    expect(reopened.getIndex()).toEqual(store.getIndex());
    expect(reopened.getFolderAccess('f1')).toEqual({ kind: 'plain-path' });
    expect(reopened.getIndex()).toHaveLength(1);
  });

  it('the same mutations outside a transaction still write once each', () => {
    const counter = createCountingFs();
    populate(open(file(dir), counter), '/media/photos');
    expect(counter.renames).toBe(4);
  });

  it('returns the callback result', () => {
    const store = open(file(dir));
    expect(store.transaction(() => 42)).toBe(42);
  });

  it('writes nothing when the callback makes no mutation', () => {
    const counter = createCountingFs();
    const store = open(file(dir), counter);
    store.transaction(() => store.listCollections());
    expect(counter.renames).toBe(0);
  });

  it('throwing rolls back memory, writes nothing and leaves the stored file byte-identical', () => {
    const f = file(dir);
    const counter = createCountingFs();
    const store = open(f, counter);
    populate(store, '/media/photos');
    const bytesBefore = fs.readFileSync(f);
    const collectionsBefore = store.listCollections();
    const foldersBefore = store.listFolders();
    const indexBefore = store.getIndex();
    counter.reset();

    expect(() =>
      store.transaction(() => {
        store.putCollection({ id: 'c2', name: 'Other', folderIds: [], createdAt: '2026-10-18T00:00:00.000Z' });
        store.setFolderUnavailable('f1', true);
        store.replaceFolderIndex('f1', []);
        store.setFolderAccess('f1', { kind: 'changed' });
        store.removeCollection('c1');
        throw new Error('boom');
      })
    ).toThrow('boom');

    expect(counter.events).toEqual([]);
    expect(fs.readFileSync(f).equals(bytesBefore)).toBe(true);
    expect(store.listCollections()).toEqual(collectionsBefore);
    expect(store.listFolders()).toEqual(foldersBefore);
    expect(store.getIndex()).toEqual(indexBefore);
    expect(store.getFolderAccess('f1')).toEqual({ kind: 'plain-path' });
    expect(fs.readdirSync(path.dirname(f))).toEqual(['store.json']);
  });

  it('a failing mutator inside the callback (unknown folder) rolls back earlier mutations', () => {
    const f = file(dir);
    const store = open(f);
    populate(store, '/media/photos');
    const bytesBefore = fs.readFileSync(f);
    expect(() =>
      store.transaction(() => {
        store.setFolderUnavailable('f1', true);
        store.setFolderUnavailable('nope', true);
      })
    ).toThrow(/unknown folder/);
    expect(store.getFolder('f1').unavailable).toBe(false);
    expect(fs.readFileSync(f).equals(bytesBefore)).toBe(true);
  });

  it('rejects a nested transaction and rolls the outer one back', () => {
    const f = file(dir);
    const counter = createCountingFs();
    const store = open(f, counter);
    expect(() =>
      store.transaction(() => {
        store.putCollection({ id: 'c1', name: 'C', folderIds: [], createdAt: '2026-10-18T00:00:00.000Z' });
        store.transaction(() => {});
      })
    ).toThrow(/nested/i);
    expect(store.listCollections()).toEqual([]);
    expect(counter.renames).toBe(0);
    store.putCollection({ id: 'c1', name: 'C', folderIds: [], createdAt: '2026-10-18T00:00:00.000Z' });
    expect(counter.renames).toBe(1);
  });

  it('rejects an async callback and does not leave the transaction open', () => {
    const store = open(file(dir));
    expect(() => store.transaction(async () => {})).toThrow(/synchronous/);
    expect(() => store.transaction(() => {})).not.toThrow();
  });

  it('a failed write at commit rolls memory back and removes the temp file', () => {
    const f = file(dir);
    const failing = {
      renameSync() {
        throw new Error('rename failed');
      },
    };
    const store = openStorage({ location: { file: f }, fs: failing });
    expect(() => store.transaction(() => store.putCollection({ id: 'c1', name: 'C', folderIds: [] }))).toThrow(
      'rename failed'
    );
    expect(store.listCollections()).toEqual([]);
    expect(fs.readdirSync(path.dirname(f))).toEqual([]);
  });

  it('writes through a temp file in the same directory, renamed over store.json, leaving no temp files', () => {
    const f = file(dir);
    const counter = createCountingFs();
    const store = open(f, counter);
    store.transaction(() => populate(store, '/media/photos'));
    expect(counter.events.map((e) => e.op)).toEqual(['write', 'rename']);
    const [write, rename] = counter.events;
    expect(write.file).toBe(rename.from);
    expect(write.file).not.toBe(f);
    expect(rename.to).toBe(f);
    expect(rename.sameDir).toBe(true);
    expect(rename.tempExistedBeforeRename).toBe(true);
    expect(fs.readdirSync(path.dirname(f))).toEqual(['store.json']);
  });
});
