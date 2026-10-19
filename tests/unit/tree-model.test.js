import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildTree, flattenVisible, compareNames } = require('../../src/shared/tree-model.js');

const folder = (id, p, unavailable = false) => ({ id, collectionId: 'c1', path: p, unavailable });
const file = (folderId, root, rel, extra = {}) => ({
  folderId,
  collectionId: 'c1',
  path: `${root}/${rel}`,
  relativePath: rel,
  name: rel.split('/').pop(),
  extension: 'jpg',
  kind: 'image',
  ...extra,
});
const names = (node) => node.children.map((c) => c.name);

describe('buildTree', () => {
  it('sorts IMG_2 before IMG_10', () => {
    const f = [folder('a', '/photos')];
    const files = ['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg'].map((n) => file('a', '/photos', n));
    const [root] = buildTree(f, files);
    expect(names(root)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  });

  it('lists subfolders before files at each level', () => {
    const f = [folder('a', '/r')];
    const files = [
      file('a', '/r', 'a.jpg'),
      file('a', '/r', 'zdir/x.jpg'),
      file('a', '/r', 'zdir/adir/y.jpg'),
      file('a', '/r', 'zdir/b.jpg'),
    ];
    const [root] = buildTree(f, files);
    expect(names(root)).toEqual(['zdir', 'a.jpg']);
    const z = root.children[0];
    expect(z.type).toBe('folder');
    expect(names(z)).toEqual(['adir', 'b.jpg', 'x.jpg']);
    expect(z.children[0].children[0].relativePath).toBe('zdir/adir/y.jpg');
  });

  it('is not affected by case differences', () => {
    const f = [folder('a', '/r')];
    const files = ['b.jpg', 'A.jpg', 'c.jpg', 'B2.jpg', 'a2.jpg'].map((n) => file('a', '/r', n));
    const [root] = buildTree(f, files);
    expect(names(root)).toEqual(['A.jpg', 'a2.jpg', 'b.jpg', 'B2.jpg', 'c.jpg']);
    const upper = buildTree(f, ['IMG_2.JPG', 'img_10.jpg'].map((n) => file('a', '/r', n)))[0];
    expect(names(upper)).toEqual(['IMG_2.JPG', 'img_10.jpg']);
  });

  it('orders names equal ignoring case deterministically regardless of input order', () => {
    const f = [folder('a', '/r')];
    const one = buildTree(f, [file('a', '/r', 'a.jpg'), file('a', '/r', 'A.jpg')])[0];
    const two = buildTree(f, [file('a', '/r', 'A.jpg'), file('a', '/r', 'a.jpg')])[0];
    expect(names(one)).toEqual(names(two));
  });

  it('shows an empty root folder with no children', () => {
    const f = [folder('a', '/r'), folder('empty', '/empty')];
    const files = [file('a', '/r', 'deep/er/est/x.jpg'), file('a', '/r', 'top.jpg')];
    const tree = buildTree(f, files);
    expect(tree.map((n) => n.name)).toEqual(['empty', 'r']);
    expect(tree[0]).toMatchObject({ type: 'folder', unavailable: false, children: [], relativePath: '' });
    expect(tree[0].id).toBe('empty');
  });

  it('shows an unavailable root with no stored files, flagged unavailable', () => {
    const tree = buildTree([folder('u', '/gone', true)], []);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'gone', unavailable: true, children: [] });
  });

  it('prunes non-root folders: only folders on a file path exist, at any depth', () => {
    const f = [folder('a', '/r')];
    // A file record with an empty relativePath and no name contributes no node.
    const files = [
      file('a', '/r', 'deep/er/est/x.jpg'),
      file('a', '/r', 'top.jpg'),
      { folderId: 'a', collectionId: 'c1', path: '/r/', relativePath: '', kind: 'image' },
    ];
    const tree = buildTree(f, files);
    const folders = [];
    (function walk(n) {
      if (n.type === 'folder') folders.push(n.relativePath);
      (n.children || []).forEach(walk);
    })(tree[0]);
    expect(folders).toEqual(['', 'deep', 'deep/er', 'deep/er/est']);
    expect(names(tree[0])).toEqual(['deep', 'top.jpg']);
  });

  it('passes unavailable through and propagates it to files', () => {
    const f = [folder('ok', '/ok'), folder('gone', '/Volumes/gone', true)];
    const files = [file('ok', '/ok', 'a.jpg'), file('gone', '/Volumes/gone', 'sub/b.jpg')];
    const tree = buildTree(f, files);
    const ok = tree.find((n) => n.name === 'ok');
    const gone = tree.find((n) => n.name === 'gone');
    expect(ok.unavailable).toBe(false);
    expect(ok.children[0].unavailable).toBe(false);
    expect(gone.unavailable).toBe(true);
    expect(gone.children[0].unavailable).toBe(true);
    expect(gone.children[0].children[0]).toMatchObject({
      type: 'file',
      unavailable: true,
      kind: 'image',
      path: '/Volumes/gone/sub/b.jpg',
    });
  });

  it('builds one root per folder, named by basename, with no cross-folder mixing', () => {
    const f = [folder('a', '/x/Photos'), folder('b', '/y/docs/')];
    const files = [file('a', '/x/Photos', '1.jpg'), file('b', '/y/docs', '2.jpg')];
    const tree = buildTree(f, files);
    expect(tree.map((n) => n.name)).toEqual(['docs', 'Photos']);
    expect(tree[1].children.map((c) => c.name)).toEqual(['1.jpg']);
    expect(tree[0].children.map((c) => c.name)).toEqual(['2.jpg']);
    expect(tree[0].relativePath).toBe('');
  });

  it('ignores files whose folder record is absent and tolerates empty input', () => {
    expect(buildTree([], [file('zz', '/q', 'a.jpg')])).toEqual([]);
    expect(buildTree(undefined, undefined)).toEqual([]);
  });
});

describe('compareNames', () => {
  it('handles leading zeros and long digit runs', () => {
    expect(compareNames('f2', 'f02')).not.toBe(0);
    expect(compareNames('f9', 'f10')).toBeLessThan(0);
    expect(compareNames('f99999999999999999999', 'f100000000000000000000')).toBeLessThan(0);
  });
});

describe('flattenVisible', () => {
  const f = [folder('a', '/r')];
  const files = [
    file('a', '/r', 'd1/x.jpg'),
    file('a', '/r', 'd1/inner/y.jpg'),
    file('a', '/r', 'd2/z.jpg'),
    file('a', '/r', 'top.jpg'),
  ];
  const tree = buildTree(f, files);
  const rows = (set) => flattenVisible(tree, set).map((r) => `${r.depth}:${r.node.name}`);

  it('shows only roots when nothing is expanded', () => {
    expect(rows(new Set())).toEqual(['0:r']);
    expect(rows(undefined)).toEqual(['0:r']);
  });

  it('shows one level when only the root is expanded', () => {
    expect(rows(new Set(['/r']))).toEqual(['0:r', '1:d1', '1:d2', '1:top.jpg']);
  });

  it('expands nested folders in order with depth', () => {
    expect(rows(new Set(['/r', '/r/d1']))).toEqual([
      '0:r', '1:d1', '2:inner', '2:x.jpg', '1:d2', '1:top.jpg',
    ]);
  });

  it('does not show descendants of a collapsed folder even if they are marked expanded', () => {
    expect(rows(new Set(['/r/d1']))).toEqual(['0:r']);
  });

  it('returns node objects from the tree', () => {
    const r = flattenVisible(tree, new Set(['/r']));
    expect(r[0].node).toBe(tree[0]);
  });
});
