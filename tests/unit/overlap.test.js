import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const overlap = require('../../src/main/collections/overlap.js');
const { findOverlaps, describeRefusal, describeReplace, dropNested, describeDropped } = overlap;

// Identity realpath keeps the pure-string cases independent of the disk.
const same = (p) => p;

describe('findOverlaps', () => {
  it('candidate inside an existing folder is covered by it', () => {
    const r = findOverlaps('/a/b/c', ['/x', '/a/b'], { realpath: same });
    expect(r.covered).toBe('/a/b');
    expect(r.contains).toEqual([]);
  });

  it('candidate containing an existing folder lists it, not covered', () => {
    const r = findOverlaps('/a', ['/x', '/a/b'], { realpath: same });
    expect(r.covered).toBeNull();
    expect(r.contains).toEqual(['/a/b']);
  });

  it('unrelated paths give both empty', () => {
    const r = findOverlaps('/a/b', ['/c/d'], { realpath: same });
    expect(r.covered).toBeNull();
    expect(r.contains).toEqual([]);
  });

  it('/a/b and /a/bc do not overlap in either direction', () => {
    for (const [c, e] of [['/a/b', '/a/bc'], ['/a/bc', '/a/b']]) {
      const r = findOverlaps(c, [e], { realpath: same });
      expect(r.covered).toBeNull();
      expect(r.contains).toEqual([]);
    }
  });

  it('trailing slash: /a/b/ against /a/b is covered', () => {
    expect(findOverlaps('/a/b/', ['/a/b'], { realpath: same }).covered).toBe('/a/b');
  });

  it('case difference: /A/B against /a/b/c is contains', () => {
    const r = findOverlaps('/A/B', ['/a/b/c'], { realpath: same });
    expect(r.covered).toBeNull();
    expect(r.contains).toEqual(['/a/b/c']);
  });

  it('identical path is covered by that folder', () => {
    expect(findOverlaps('/a/b', ['/a/b'], { realpath: same }).covered).toBe('/a/b');
  });

  it('several covering folders: names the first and counts them', () => {
    const r = findOverlaps('/a/b/c', ['/a/b', '/a'], { realpath: same });
    expect(r.covered).toBe('/a/b');
    expect(r.coveredCount).toBe(2);
  });

  it('symlinked candidate to an existing folder is covered (real realpath)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overlap-'));
    try {
      const target = path.join(tmp, 'target');
      const link = path.join(tmp, 'link');
      fs.mkdirSync(target);
      fs.symlinkSync(target, link);
      const r = findOverlaps(link, [target]);
      expect(r.covered).toBe(target);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('nonexistent candidate is compared by path.resolve and does not throw', () => {
    const missing = path.join(os.tmpdir(), 'overlap-does-not-exist-xyz', 'child');
    let r;
    expect(() => {
      r = findOverlaps(missing, [path.dirname(missing)]);
    }).not.toThrow();
    expect(r.covered).toBe(path.dirname(missing));
  });

  it('an injected realpath that throws for one path falls back to path.resolve', () => {
    const realpath = (p) => {
      if (p === '/a/b/c') throw new Error('ENOENT');
      return p;
    };
    const r = findOverlaps('/a/b/c', ['/a/b'], { realpath });
    expect(r.covered).toBe('/a/b');
  });

  it('identical is true for an identical path, with a trailing slash and in a different case', () => {
    for (const c of ['/a/b', '/a/b/', '/A/B']) {
      const r = findOverlaps(c, ['/a/b'], { realpath: same });
      expect(r.identical).toBe(true);
      expect(r.covered).toBe('/a/b');
    }
  });

  it('identical is false for inside, contains and unrelated', () => {
    expect(findOverlaps('/a/b/c', ['/a/b'], { realpath: same }).identical).toBe(false);
    expect(findOverlaps('/a', ['/a/b'], { realpath: same }).identical).toBe(false);
    expect(findOverlaps('/a', ['/b'], { realpath: same }).identical).toBe(false);
  });

  it('a symlink to an existing folder is identical (real realpath)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'overlap-'));
    try {
      const target = path.join(tmp, 'target');
      const link = path.join(tmp, 'link');
      fs.mkdirSync(target);
      fs.symlinkSync(target, link);
      expect(findOverlaps(link, [target]).identical).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('describeRefusal', () => {
  const r = (c, e) => findOverlaps(c, e, { realpath: same });

  it('inside: "already covered" and the covering folder', () => {
    const text = describeRefusal(r('/a/b/c', ['/a/b']), '/a/b/c');
    expect(text).toContain('already covered');
    expect(text).toContain('/a/b');
  });

  it('identical: "already in the collection" and the path', () => {
    const text = describeRefusal(r('/a/b', ['/a/b']), '/a/b');
    expect(text).toContain('already in the collection');
    expect(text).toContain('/a/b');
  });

  it('contains and unrelated give null', () => {
    expect(describeRefusal(r('/a', ['/a/b']), '/a')).toBeNull();
    expect(describeRefusal(r('/a', ['/b']), '/a')).toBeNull();
  });

  it('inside one folder and containing another gives the refusal', () => {
    const text = describeRefusal(r('/a/b', ['/a', '/a/b/c']), '/a/b');
    expect(text).toContain('already covered');
    expect(text).toContain('/a');
  });

  it('mentions how many other folders cover it', () => {
    expect(describeRefusal(r('/a/b/c', ['/a/b', '/a']), '/a/b/c')).toContain('1 other folder');
  });
});

describe('describeReplace', () => {
  const r = (c, e) => findOverlaps(c, e, { realpath: same });

  it('one contained folder: detail names it and says it will be replaced', () => {
    const out = describeReplace(r('/a', ['/a/b']), '/a');
    expect(typeof out.message).toBe('string');
    expect(out.detail).toContain('/a/b');
    expect(out.detail).toContain('will be replaced');
  });

  it('three contained folders: detail names all three', () => {
    const out = describeReplace(r('/a', ['/a/b', '/a/c', '/a/d']), '/a');
    for (const p of ['/a/b', '/a/c', '/a/d']) expect(out.detail).toContain(p);
  });

  it('inside, identical and unrelated give null', () => {
    expect(describeReplace(r('/a/b', ['/a']), '/a/b')).toBeNull();
    expect(describeReplace(r('/a', ['/a']), '/a')).toBeNull();
    expect(describeReplace(r('/a', ['/b']), '/a')).toBeNull();
  });

  it('a candidate inside one folder and containing another gives null', () => {
    expect(describeReplace(r('/a/b', ['/a', '/a/b/c']), '/a/b')).toBeNull();
  });
});

describe('dropNested', () => {
  it('keeps the outermost picks and reports the rest with their covering pick', () => {
    expect(dropNested(['/a', '/a/b', '/a/b/c', '/x'], { realpath: same })).toEqual({
      kept: ['/a', '/x'],
      dropped: [{ path: '/a/b', coveredBy: '/a' }, { path: '/a/b/c', coveredBy: '/a' }],
    });
  });

  it('gives the same decision when the picks are given inner first', () => {
    const out = dropNested(['/a/b/c', '/a/b', '/x', '/a'], { realpath: same });
    expect(out.kept).toEqual(['/x', '/a']);
    expect(out.dropped).toEqual([{ path: '/a/b/c', coveredBy: '/a' }, { path: '/a/b', coveredBy: '/a' }]);
  });

  it('picks identical after realpath keep the first and drop the later one', () => {
    const realpath = (p) => (p === '/link' ? '/target' : p);
    expect(dropNested(['/target', '/link'], { realpath })).toEqual({
      kept: ['/target'],
      dropped: [{ path: '/link', coveredBy: '/target' }],
    });
    expect(dropNested(['/link', '/target'], { realpath })).toEqual({
      kept: ['/link'],
      dropped: [{ path: '/target', coveredBy: '/link' }],
    });
  });

  it('/a/b and /a/bc do not drop each other', () => {
    expect(dropNested(['/a/b', '/a/bc'], { realpath: same })).toEqual({ kept: ['/a/b', '/a/bc'], dropped: [] });
  });

  it('picks with nothing nested are all kept', () => {
    expect(dropNested(['/x', '/y'], { realpath: same })).toEqual({ kept: ['/x', '/y'], dropped: [] });
  });
});

describe('describeDropped', () => {
  it('returns null for an empty list', () => {
    expect(describeDropped([])).toBeNull();
  });

  it('names every dropped folder and the folder that covers it', () => {
    const text = describeDropped([{ path: '/a/b', coveredBy: '/a' }, { path: '/x/y', coveredBy: '/x' }]);
    for (const p of ['/a/b', '/a', '/x/y', '/x']) expect(text).toContain(p);
  });
});

describe('module exports', () => {
  it('no longer exports describeOverlap', () => {
    expect(overlap.describeOverlap).toBeUndefined();
  });
});
