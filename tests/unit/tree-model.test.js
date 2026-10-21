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
    expect(tree[0].id).toBe('empty:');
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
    expect(rows(new Set(['a:']))).toEqual(['0:r', '1:d1', '1:d2', '1:top.jpg']);
  });

  it('expands nested folders in order with depth', () => {
    expect(rows(new Set(['a:', 'a:d1']))).toEqual([
      '0:r', '1:d1', '2:inner', '2:x.jpg', '1:d2', '1:top.jpg',
    ]);
  });

  it('does not show descendants of a collapsed folder even if they are marked expanded', () => {
    expect(rows(new Set(['a:d1']))).toEqual(['0:r']);
  });

  it('returns node objects from the tree', () => {
    const r = flattenVisible(tree, new Set(['a:']));
    expect(r[0].node).toBe(tree[0]);
  });
});

describe('node ids with overlapping roots', () => {
  // Roots /a and /a/b: the subfolder b under /a and the root /a/b share the path /a/b.
  const folders = [folder('fa', '/a'), folder('fb', '/a/b')];
  const files = [file('fa', '/a', 'b/x.jpg'), file('fb', '/a/b', 'y.jpg')];
  const tree = buildTree(folders, files);

  const walk = (nodes, out = []) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children) walk(n.children, out);
    }
    return out;
  };

  it('gives every node an id, all distinct, including the two nodes with path /a/b', () => {
    const all = walk(tree);
    const ids = all.map((n) => n.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const clash = all.filter((n) => n.type === 'folder' && n.path === '/a/b');
    expect(clash).toHaveLength(2);
    expect(clash[0].id).not.toBe(clash[1].id);
  });

  it('uses <root folder id>:<relative path>', () => {
    const rootA = tree.find((n) => n.path === '/a');
    expect(rootA.id).toBe('fa:');
    expect(rootA.children[0].id).toBe('fa:b');
    expect(rootA.children[0].children[0].id).toBe('fa:b/x.jpg');
  });

  it('expands only the node whose id is in the expanded set', () => {
    const rootA = tree.find((n) => n.path === '/a');
    const rootB = tree.find((n) => n.path === '/a/b');
    const subB = rootA.children[0];
    const ids = (set) => flattenVisible(tree, set).map((r) => r.node.id);
    // Only the root /a/b expanded: its file shows, the subfolder under /a stays collapsed.
    expect(ids(new Set([rootB.id]))).toEqual(['fa:', 'fb:', 'fb:y.jpg']);
    // Root /a and subfolder b under it expanded: root /a/b stays collapsed.
    expect(ids(new Set([rootA.id, subB.id]))).toEqual(['fa:', 'fa:b', 'fa:b/x.jpg', 'fb:']);
  });
});

describe('buildTree de-duplication across overlapping roots', () => {
  const walk = (nodes, out = []) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children) walk(n.children, out);
    }
    return out;
  };
  const filesUnder = (tree, folderId) =>
    walk(tree)
      .filter((n) => n.type === 'file' && n.folderId === folderId)
      .map((n) => n.relativePath);
  const rootOf = (tree, id) => tree.find((n) => n.id === id + ':');

  // /m holds sub/x.jpg and /m/sub holds x.jpg: the same file.
  const outer = folder('m', '/m');
  const inner = folder('s', '/m/sub');
  const outerFiles = [file('m', '/m', 'sub/x.jpg'), file('m', '/m', 'top.jpg')];
  const innerFiles = [file('s', '/m/sub', 'x.jpg')];

  it('shows the file under the outer root only and still returns the empty inner root', () => {
    const tree = buildTree([outer, inner], [...outerFiles, ...innerFiles]);
    expect(filesUnder(tree, 'm')).toEqual(['sub/x.jpg', 'top.jpg']);
    expect(filesUnder(tree, 's')).toEqual([]);
    expect(tree).toHaveLength(2);
    expect(rootOf(tree, 's').children).toEqual([]);
  });

  it('gives the same tree when the outer root is given last', () => {
    const a = buildTree([outer, inner], [...outerFiles, ...innerFiles]);
    const b = buildTree([inner, outer], [...innerFiles, ...outerFiles]);
    expect(b).toEqual(a);
  });

  it('keeps the file under the earlier of two identical-path roots', () => {
    const r1 = folder('r1', '/same');
    const r2 = folder('r2', '/same');
    const files = [file('r1', '/same', 'a.jpg'), file('r2', '/same', 'a.jpg')];
    let tree = buildTree([r1, r2], files);
    expect(filesUnder(tree, 'r1')).toEqual(['a.jpg']);
    expect(filesUnder(tree, 'r2')).toEqual([]);
    tree = buildTree([r2, r1], files);
    expect(filesUnder(tree, 'r2')).toEqual(['a.jpg']);
    expect(filesUnder(tree, 'r1')).toEqual([]);
  });

  it('shows each file once under the outermost root that has a record, with three nested roots', () => {
    const f = [folder('a', '/a'), folder('b', '/a/b'), folder('c', '/a/b/c')];
    const files = [
      file('a', '/a', 'b/c/1.jpg'),
      file('b', '/a/b', 'c/1.jpg'),
      file('c', '/a/b/c', '1.jpg'),
      // 2.jpg is not in /a's index: the middle root owns it.
      file('b', '/a/b', 'c/2.jpg'),
      file('c', '/a/b/c', '2.jpg'),
    ];
    const tree = buildTree(f, files);
    expect(filesUnder(tree, 'a')).toEqual(['b/c/1.jpg']);
    expect(filesUnder(tree, 'b')).toEqual(['c/2.jpg']);
    expect(filesUnder(tree, 'c')).toEqual([]);
  });

  it('keeps a file under the inner root when the outer root has no record of it (stale outer index)', () => {
    const tree = buildTree([outer, inner], [file('m', '/m', 'top.jpg'), ...innerFiles]);
    expect(filesUnder(tree, 'm')).toEqual(['top.jpg']);
    expect(filesUnder(tree, 's')).toEqual(['x.jpg']);
  });

  it('does not let /a/b and /a/bc interact', () => {
    const f = [folder('p', '/a/b'), folder('q', '/a/bc')];
    const files = [file('p', '/a/b', 'x.jpg'), file('q', '/a/bc', 'x.jpg')];
    const tree = buildTree(f, files);
    expect(filesUnder(tree, 'p')).toEqual(['x.jpg']);
    expect(filesUnder(tree, 'q')).toEqual(['x.jpg']);
  });

  it('keeps case-different roots apart (a case-sensitive volume has two folders)', () => {
    const f = [folder('u', '/A/B'), folder('l', '/a/b')];
    const files = [file('u', '/A/B', 'x.jpg'), file('l', '/a/b', 'x.jpg')];
    const tree = buildTree(f, files);
    expect(filesUnder(tree, 'u')).toEqual(['x.jpg']);
    expect(filesUnder(tree, 'l')).toEqual(['x.jpg']);
  });

  it('treats roots whose resolvedPath is the same on-disk case as identical, whatever path says', () => {
    const f = [
      { ...folder('u', '/A/B'), resolvedPath: '/a/b' },
      { ...folder('l', '/a/b'), resolvedPath: '/a/b' },
    ];
    const files = [file('u', '/A/B', 'x.jpg'), file('l', '/a/b', 'x.jpg')];
    const tree = buildTree(f, files);
    expect(filesUnder(tree, 'u')).toEqual(['x.jpg']);
    expect(filesUnder(tree, 'l')).toEqual([]);
  });

  it('treats roots with different paths but equal resolvedPath as identical', () => {
    const f = [
      { ...folder('r1', '/link'), resolvedPath: '/real' },
      { ...folder('r2', '/real'), resolvedPath: '/real' },
    ];
    const files = [file('r1', '/link', 'x.jpg'), file('r2', '/real', 'x.jpg')];
    const tree = buildTree(f, files);
    expect(filesUnder(tree, 'r1')).toEqual(['x.jpg']);
    expect(filesUnder(tree, 'r2')).toEqual([]);
  });

  it('uses path when a root has no resolvedPath, and resolvedPath for nesting when present', () => {
    const f = [
      { ...folder('o', '/link-o'), resolvedPath: '/real/o' },
      { ...folder('i', '/elsewhere/i'), resolvedPath: '/real/o/i' },
    ];
    const files = [file('o', '/real/o', 'i/x.jpg'), file('i', '/real/o/i', 'x.jpg')];
    const tree = buildTree(f, files);
    expect(filesUnder(tree, 'i')).toEqual([]);
    const plain = buildTree([folder('o', '/real/o'), folder('i', '/real/o/i')], files);
    expect(filesUnder(plain, 'i')).toEqual([]);
  });

  it('keeps ids as <rootFolderId>:<relativePath> and unique across roots', () => {
    const tree = buildTree([outer, inner], [...outerFiles, ...innerFiles]);
    const ids = walk(tree).map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('m:sub/x.jpg');
    expect(ids).toContain('s:');
  });

  it('shows the file under the inner root once the outer root is removed', () => {
    const tree = buildTree([inner], [...innerFiles]);
    expect(filesUnder(tree, 's')).toEqual(['x.jpg']);
  });

  it('is deterministic for the same input', () => {
    const args = [[outer, inner], [...outerFiles, ...innerFiles]];
    expect(buildTree(...args)).toEqual(buildTree(...args));
  });

  it('lets an unavailable outer root own the file', () => {
    const tree = buildTree([folder('m', '/m', true), inner], [...outerFiles, ...innerFiles]);
    expect(filesUnder(tree, 'm')).toEqual(['sub/x.jpg', 'top.jpg']);
    expect(filesUnder(tree, 's')).toEqual([]);
  });

  it('builds 20,000 records across two overlapping roots within 2 seconds', () => {
    const n = 10000;
    const of = [];
    const inf = [];
    for (let i = 0; i < n; i++) {
      of.push(file('m', '/m', `sub/f${i}.jpg`));
      inf.push(file('s', '/m/sub', `f${i}.jpg`));
    }
    const start = Date.now();
    const tree = buildTree([outer, inner], [...of, ...inf]);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(filesUnder(tree, 's')).toEqual([]);
  });
});
