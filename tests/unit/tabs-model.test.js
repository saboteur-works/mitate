import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TABS, nextTab, emptyText } = require('../../src/shared/tabs-model.js');

describe('TABS', () => {
  it('lists the tabs in order with labels', () => {
    expect(TABS.map((t) => [t.id, t.label])).toEqual([
      ['tree', 'Tree'],
      ['image', 'Images'],
      ['audio', 'Audio'],
      ['video', 'Video'],
      ['document', 'Documents'],
    ]);
  });
});

describe('nextTab', () => {
  it('moves right and left', () => {
    expect(nextTab(1, 'ArrowRight', 5)).toBe(2);
    expect(nextTab(3, 'ArrowLeft', 5)).toBe(2);
  });

  it('wraps at both ends', () => {
    expect(nextTab(4, 'ArrowRight', 5)).toBe(0);
    expect(nextTab(0, 'ArrowLeft', 5)).toBe(4);
  });

  it('jumps with Home and End', () => {
    expect(nextTab(3, 'Home', 5)).toBe(0);
    expect(nextTab(1, 'End', 5)).toBe(4);
  });

  it('returns null for other keys or no tabs', () => {
    expect(nextTab(1, 'Enter', 5)).toBeNull();
    expect(nextTab(1, 'ArrowDown', 5)).toBeNull();
    expect(nextTab(0, 'ArrowRight', 0)).toBeNull();
  });
});

describe('emptyText', () => {
  it('names the kind in plain words', () => {
    for (const kind of ['image', 'audio', 'video', 'document']) {
      expect(emptyText(kind)).toBe(`No ${kind} files in this collection`);
    }
  });

  it('throws for the tree and unknown views', () => {
    expect(() => emptyText('tree')).toThrow();
    expect(() => emptyText('bogus')).toThrow();
  });
});

describe('module loading', () => {
  it('defines globalThis.TabsModel as a classic script', () => {
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(new URL('../../src/shared/tabs-model.js', import.meta.url), 'utf8'), ctx);
    expect(vm.runInContext('TabsModel.TABS.length', ctx)).toBe(5);
  });
});
