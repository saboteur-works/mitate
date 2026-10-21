import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { buildTypeList } = require('../../src/shared/type-list.js');
const { buildTree, compareNames } = require('../../src/shared/tree-model.js');

const folder = (id, p, unavailable = false) => ({ id, collectionId: 'c1', path: p, unavailable });
const file = (folderId, root, rel, extra = {}) => ({
  folderId,
  collectionId: 'c1',
  path: `${root}/${rel}`,
  relativePath: rel,
  name: rel.split('/').pop(),
  extension: rel.split('.').pop().toLowerCase(),
  kind: 'image',
  ...extra,
});
const names = (rows) => rows.map((r) => r.name);
const paths = (rows) => rows.map((r) => r.path);

describe('buildTypeList selection by kind', () => {
  const f = [folder('a', '/a'), folder('b', '/b')];
  const files = [
    file('a', '/a', 'p/1.jpg'),
    file('a', '/a', 'p/q/2.cr2', { kind: 'image' }),
    file('a', '/a', 'UP.JPG'),
    file('a', '/a', 'm/s.mp3', { kind: 'audio' }),
    file('b', '/b', 'v.mp4', { kind: 'video' }),
    file('b', '/b', 'deep/er/d.pdf', { kind: 'document' }),
    file('b', '/b', 'n.txt', { kind: 'document' }),
    file('other', '/x', 'orphan.jpg'),
    file('b', '/b', 'c.cbz', { kind: 'document' }),
  ];

  it('lists exactly the files of each kind and no other kind or collection', () => {
    expect(paths(buildTypeList(f, files, 'image'))).toEqual(['/a/p/1.jpg', '/a/p/q/2.cr2', '/a/UP.JPG']);
    expect(paths(buildTypeList(f, files, 'audio'))).toEqual(['/a/m/s.mp3']);
    expect(paths(buildTypeList(f, files, 'video'))).toEqual(['/b/v.mp4']);
    expect(paths(buildTypeList(f, files, 'document'))).toEqual(['/b/c.cbz', '/b/deep/er/d.pdf', '/b/n.txt']);
  });

  it('keeps a RAW file in the image list and an uppercase extension under its stored kind', () => {
    const rows = buildTypeList(f, files, 'image');
    expect(names(rows)).toContain('2.cr2');
    expect(names(rows)).toContain('UP.JPG');
  });

  it('puts a .txt file in the document list', () => {
    expect(names(buildTypeList(f, files, 'document'))).toContain('n.txt');
  });

  it('gives each row its fields and a folder label', () => {
    const rows = buildTypeList(f, files, 'image');
    expect(rows.find((r) => r.name === '2.cr2')).toEqual({
      nodeId: 'a:p/q/2.cr2',
      path: '/a/p/q/2.cr2',
      name: '2.cr2',
      folderId: 'a',
      relativePath: 'p/q/2.cr2',
      kind: 'image',
      unavailable: false,
      folder: 'p/q',
    });
    expect(rows.find((r) => r.name === 'UP.JPG').folder).toBe('a');
    expect(buildTypeList([folder('ph', '/home/me/Photos')], [file('ph', '/home/me/Photos', '2024/x.jpg')], 'image')[0].folder).toBe(
      '2024',
    );
    expect(buildTypeList([folder('ph', '/home/me/Photos/')], [file('ph', '/home/me/Photos', 'x.jpg')], 'image')[0].folder).toBe(
      'Photos',
    );
  });

  it('gives each row the id the tree gives the same file', () => {
    const walk = (nodes, out = []) => {
      for (const n of nodes) {
        if (n.type === 'file') out.push(n.id);
        if (n.children) walk(n.children, out);
      }
      return out;
    };
    const treeIds = walk(buildTree(f, files)).sort();
    const listIds = ['image', 'audio', 'video', 'document'].flatMap((k) => buildTypeList(f, files, k).map((r) => r.nodeId)).sort();
    expect(listIds).toEqual(treeIds);
  });
});

describe('buildTypeList order', () => {
  it('orders by compareNames: natural numeric and case-insensitive', () => {
    const f = [folder('a', '/a')];
    const rows = buildTypeList(f, ['img10.jpg', 'img2.jpg', 'B.jpg', 'a.jpg'].map((n) => file('a', '/a', n)), 'image');
    expect(names(rows)).toEqual(['a.jpg', 'B.jpg', 'img2.jpg', 'img10.jpg']);
    expect(names(rows)).toEqual([...names(rows)].sort(compareNames));
  });

  it('keeps equal names from different folders and orders them by absolute path, repeatably', () => {
    const f = [folder('z', '/z'), folder('a', '/a')];
    const files = [file('z', '/z', 'IMG_1.jpg'), file('a', '/a', 'sub/IMG_1.jpg')];
    const rows = buildTypeList(f, files, 'image');
    expect(paths(rows)).toEqual(['/a/sub/IMG_1.jpg', '/z/IMG_1.jpg']);
    expect(rows.map((r) => r.folder)).toEqual(['sub', 'z']);
    expect(buildTypeList(f, [...files].reverse(), 'image')).toEqual(rows);
    expect(buildTypeList(f, files, 'image')).toEqual(rows);
  });
});

describe('buildTypeList one appearance', () => {
  const treePaths = (folders, files) => {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.type === 'file') out.push(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(buildTree(folders, files));
    return out.sort();
  };
  const expectSameAsTree = (folders, files) => {
    const rows = buildTypeList(folders, files, 'image');
    expect(new Set(paths(rows)).size).toBe(rows.length);
    expect(paths(rows).sort()).toEqual(treePaths(folders, files));
  };

  it('matches the tree for nested roots', () => {
    expectSameAsTree(
      [folder('a', '/a'), folder('b', '/a/b'), folder('c', '/a/b/c')],
      [
        file('a', '/a', 'b/c/1.jpg'),
        file('b', '/a/b', 'c/1.jpg'),
        file('c', '/a/b/c', '1.jpg'),
        file('b', '/a/b', 'c/2.jpg'),
        file('c', '/a/b/c', '2.jpg'),
      ],
    );
  });

  it('matches the tree for identical-path roots, keeping the earliest', () => {
    const folders = [folder('r1', '/same'), folder('r2', '/same')];
    const files = [file('r1', '/same', 'a.jpg'), file('r2', '/same', 'a.jpg')];
    expectSameAsTree(folders, files);
    expect(buildTypeList(folders, files, 'image').map((r) => r.folderId)).toEqual(['r1']);
  });

  it('keeps a case-differing pair distinct, as the tree does', () => {
    const folders = [folder('u', '/A/B'), folder('l', '/a/b')];
    const files = [file('u', '/A/B', 'x.jpg'), file('l', '/a/b', 'x.jpg')];
    expectSameAsTree(folders, files);
    expect(buildTypeList(folders, files, 'image')).toHaveLength(2);
  });

  it('keeps a file with the inner root when the outer has no record of it', () => {
    const folders = [folder('m', '/m'), folder('s', '/m/sub')];
    const files = [file('m', '/m', 'top.jpg'), file('s', '/m/sub', 'x.jpg')];
    expectSameAsTree(folders, files);
    expect(paths(buildTypeList(folders, files, 'image'))).toContain('/m/sub/x.jpg');
  });
});

describe('buildTypeList states and errors', () => {
  it('flags the files of an unavailable folder and lists them', () => {
    const rows = buildTypeList([folder('a', '/a'), folder('g', '/gone', true)], [file('a', '/a', '1.jpg'), file('g', '/gone', 'x.jpg')], 'image');
    expect(rows.map((r) => [r.name, r.unavailable])).toEqual([
      ['1.jpg', false],
      ['x.jpg', true],
    ]);
  });

  it('flags a file whose own record says unavailable', () => {
    const rows = buildTypeList([folder('a', '/a')], [file('a', '/a', '1.jpg', { unavailable: true })], 'image');
    expect(rows[0].unavailable).toBe(true);
  });

  it('returns [] for empty input and for a kind with no files', () => {
    expect(buildTypeList([], [], 'image')).toEqual([]);
    expect(buildTypeList(undefined, undefined, 'audio')).toEqual([]);
    expect(buildTypeList([folder('a', '/a')], [file('a', '/a', '1.jpg')], 'video')).toEqual([]);
  });

  it('throws on an unknown kind', () => {
    expect(() => buildTypeList([], [], 'tree')).toThrow(/Unknown kind/);
    expect(() => buildTypeList([], [], undefined)).toThrow();
  });

  it('does not mutate its input', () => {
    const folders = [folder('b', '/b'), folder('a', '/a')];
    const files = [file('b', '/b', 'z.jpg'), file('a', '/a', 'a.jpg')];
    const before = JSON.stringify([folders, files]);
    buildTypeList(folders, files, 'image');
    expect(JSON.stringify([folders, files])).toBe(before);
  });
});

describe('loading', () => {
  const sharedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/shared');
  const load = (ctx, name) => {
    const p = path.join(sharedDir, name);
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p });
  };

  it('sets globalThis.TypeList when module is undefined, after tree-model.js', () => {
    const ctx = vm.createContext({});
    load(ctx, 'path-compare.js');
    load(ctx, 'tree-model.js');
    load(ctx, 'type-list.js');
    expect(vm.runInContext('typeof TypeList', ctx)).toBe('object');
    expect(vm.runInContext('typeof TypeList.buildTypeList', ctx)).toBe('function');
    const rows = vm.runInContext(
      "TypeList.buildTypeList([{id:'a',path:'/a'}],[{folderId:'a',path:'/a/x.jpg',relativePath:'x.jpg',name:'x.jpg',kind:'image'}],'image').length",
      ctx,
    );
    expect(rows).toBe(1);
  });

  it('exports through module.exports under Node', () => {
    expect(typeof require('../../src/shared/type-list.js').buildTypeList).toBe('function');
  });
});
