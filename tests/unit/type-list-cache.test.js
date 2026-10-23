import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createTypeListCache } = require('../../src/shared/type-list-cache.js');

const folders = [{ id: 'a', path: '/a' }];
const files = [{ folderId: 'a', path: '/a/x.jpg', relativePath: 'x.jpg', name: 'x.jpg', kind: 'image' }];
const makeBuild = () => vi.fn((f, fl, kind) => [{ kind, n: fl.length }]);

describe('createTypeListCache', () => {
  it('never calls the build function before a get', () => {
    const build = makeBuild();
    const cache = createTypeListCache(build);
    cache.setData(folders, files);
    expect(build).not.toHaveBeenCalled();
  });

  it('builds a kind once on first get and returns the same array afterwards', () => {
    const build = makeBuild();
    const cache = createTypeListCache(build);
    cache.setData(folders, files);
    const first = cache.get('image');
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(folders, files, 'image');
    expect(cache.get('image')).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('builds only the kinds that are requested', () => {
    const build = makeBuild();
    const cache = createTypeListCache(build);
    cache.setData(folders, files);
    cache.get('image');
    cache.get('audio');
    expect(build.mock.calls.map((c) => c[2])).toEqual(['image', 'audio']);
  });

  it('drops every list when setData replaces the data', () => {
    const build = makeBuild();
    const cache = createTypeListCache(build);
    cache.setData(folders, files);
    const old = cache.get('image');
    cache.get('audio');
    const newFiles = [...files, { ...files[0], path: '/a/y.jpg', name: 'y.jpg', relativePath: 'y.jpg' }];
    cache.setData(folders, newFiles);
    expect(build).toHaveBeenCalledTimes(2);
    const fresh = cache.get('image');
    expect(fresh).not.toBe(old);
    expect(fresh).toEqual([{ kind: 'image', n: 2 }]);
    expect(build).toHaveBeenLastCalledWith(folders, newFiles, 'image');
    cache.get('audio');
    expect(build).toHaveBeenCalledTimes(4);
  });

  it('drops the lists and the data on clear, and get then returns []', () => {
    const build = makeBuild();
    const cache = createTypeListCache(build);
    cache.setData(folders, files);
    cache.get('image');
    cache.clear();
    expect(cache.get('image')).toEqual([]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('returns [] before any setData without calling build', () => {
    const build = makeBuild();
    expect(createTypeListCache(build).get('video')).toEqual([]);
    expect(build).not.toHaveBeenCalled();
  });

  it('does not share state between two caches', () => {
    const build = makeBuild();
    const one = createTypeListCache(build);
    const two = createTypeListCache(build);
    one.setData(folders, files);
    one.get('image');
    expect(two.get('image')).toEqual([]);
    two.setData(folders, []);
    expect(two.get('image')).toEqual([{ kind: 'image', n: 0 }]);
    expect(one.get('image')).toEqual([{ kind: 'image', n: 1 }]);
  });

  it('returns the injected build result unmodified', () => {
    const result = Object.freeze([]);
    const cache = createTypeListCache(() => result);
    cache.setData(folders, files);
    expect(cache.get('document')).toBe(result);
  });

  it('uses TypeList.buildTypeList by default', () => {
    const cache = createTypeListCache();
    cache.setData(folders, files);
    expect(cache.get('image').map((r) => r.nodeId)).toEqual(['a:x.jpg']);
    expect(cache.get('audio')).toEqual([]);
    expect(() => cache.get('tree')).toThrow(/Unknown kind/);
  });
});

describe('loading', () => {
  const sharedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/shared');
  it('sets globalThis.TypeListCache when module is undefined', () => {
    const ctx = vm.createContext({});
    for (const name of ['path-compare.js', 'tree-model.js', 'type-list.js', 'type-list-cache.js']) {
      const p = path.join(sharedDir, name);
      vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p });
    }
    expect(vm.runInContext('typeof TypeListCache', ctx)).toBe('object');
    expect(
      vm.runInContext(
        "const c = TypeListCache.createTypeListCache(); c.setData([{id:'a',path:'/a'}],[{folderId:'a',path:'/a/x.jpg',relativePath:'x.jpg',name:'x.jpg',kind:'image'}]); c.get('image').length",
        ctx,
      ),
    ).toBe(1);
  });
});
