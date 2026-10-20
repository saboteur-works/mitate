import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { findOverlaps, describeOverlap } = require('../../src/main/collections/overlap.js');

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
});

describe('describeOverlap', () => {
  it('covered wording names the folder', () => {
    const text = describeOverlap(findOverlaps('/a/b/c', ['/a/b'], { realpath: same }), '/a/b/c');
    expect(text).toContain('already covered');
    expect(text).toContain('/a/b');
  });

  it('contains wording names the inner folder', () => {
    const text = describeOverlap(findOverlaps('/a', ['/a/b'], { realpath: same }), '/a');
    expect(text).toContain('the collection already contains a folder inside the one being added');
    expect(text).toContain('/a/b');
  });

  it('both at once give one message listing both', () => {
    const result = findOverlaps('/a/b', ['/a', '/a/b/c'], { realpath: same });
    const text = describeOverlap(result, '/a/b');
    expect(typeof text).toBe('string');
    expect(text).toContain('already covered');
    expect(text).toContain('the collection already contains a folder inside the one being added');
    expect(text).toContain('/a/b/c');
    expect(text.split('\n')).toHaveLength(1);
  });

  it('mentions the count when several folders overlap', () => {
    const result = findOverlaps('/a', ['/a/b', '/a/c'], { realpath: same });
    expect(describeOverlap(result, '/a')).toContain('2 in total');
  });

  it('no overlap gives null', () => {
    expect(describeOverlap(findOverlaps('/a', ['/b'], { realpath: same }), '/a')).toBeNull();
  });
});
