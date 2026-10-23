import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ListWindow = require('../../src/shared/list-window.js');
const { windowFor, ensureVisible, rowTop } = ListWindow;

const base = { viewportHeight: 480, rowHeight: 24, buffer: 5 };
const bound = (o) => Math.ceil(o.viewportHeight / o.rowHeight) + 2 * o.buffer + 1;

describe('windowFor', () => {
  it('renders nothing for 0 rows', () => {
    const w = windowFor({ ...base, scrollTop: 0, rowCount: 0 });
    expect(w.count).toBe(0);
    expect(w.spacerHeight).toBe(0);
  });

  it('renders the one row of a 1-row list', () => {
    const w = windowFor({ ...base, scrollTop: 0, rowCount: 1 });
    expect(w).toMatchObject({ first: 0, last: 0, count: 1, spacerHeight: 24 });
  });

  it('renders a viewport of rows plus the buffer on the side that has rows', () => {
    expect(windowFor({ ...base, scrollTop: 0, rowCount: 20 }).count).toBe(20);
    expect(windowFor({ ...base, scrollTop: 0, rowCount: 100 }).count).toBe(25);
  });

  it('does not grow with 500,000 rows at the top, middle and end', () => {
    const rowCount = 500000;
    const max = rowCount * 24 - 480;
    for (const scrollTop of [0, (rowCount / 2) * 24, max]) {
      const w = windowFor({ ...base, scrollTop, rowCount });
      expect(w.count).toBeGreaterThan(0);
      expect(w.count).toBeLessThanOrEqual(bound(base));
    }
  });

  it('has a spacer of rowCount * rowHeight', () => {
    expect(windowFor({ ...base, scrollTop: 0, rowCount: 500000 }).spacerHeight).toBe(12000000);
  });

  it('ends on the last row at the maximum scroll', () => {
    const w = windowFor({ ...base, scrollTop: 500000 * 24 - 480, rowCount: 500000 });
    expect(w.last).toBe(499999);
  });

  it('clamps a scrollTop past the end or negative', () => {
    const past = windowFor({ ...base, scrollTop: 1e12, rowCount: 1000 });
    expect(past.last).toBe(999);
    expect(past.scrollTop).toBe(1000 * 24 - 480);
    const neg = windowFor({ ...base, scrollTop: -500, rowCount: 1000 });
    expect(neg.first).toBe(0);
    expect(neg.scrollTop).toBe(0);
  });

  it('uses the tree defaults when sizes are omitted', () => {
    const w = windowFor({ viewportHeight: 480, scrollTop: 0, rowCount: 100 });
    expect(w.count).toBe(25);
  });
});

describe('rowTop', () => {
  it('is index * rowHeight', () => {
    expect(rowTop(10, 24)).toBe(240);
    expect(rowTop(3)).toBe(72);
  });
});

describe('ensureVisible', () => {
  const o = { ...base, rowCount: 500000 };

  it('scrolls up to a row above the viewport', () => {
    expect(ensureVisible(0, { ...o, scrollTop: 1000 })).toBe(0);
  });

  it('scrolls a far row into view at the bottom edge', () => {
    expect(ensureVisible(250000, { ...o, scrollTop: 0 })).toBe(250001 * 24 - 480);
    expect(ensureVisible(499999, { ...o, scrollTop: 0 })).toBe(500000 * 24 - 480);
  });

  it('leaves scrollTop alone for a row already visible', () => {
    expect(ensureVisible(5, { ...o, scrollTop: 0 })).toBe(0);
    expect(ensureVisible(250000, { ...o, scrollTop: 250000 * 24 })).toBe(250000 * 24);
  });

  it('returns 0 for an empty list', () => {
    expect(ensureVisible(0, { ...base, rowCount: 0, scrollTop: 0 })).toBe(0);
  });
});

describe('module loading', () => {
  it('defines globalThis.ListWindow as a classic script', () => {
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(new URL('../../src/shared/list-window.js', import.meta.url), 'utf8'), ctx);
    expect(vm.runInContext('typeof ListWindow.windowFor', ctx)).toBe('function');
  });
});
