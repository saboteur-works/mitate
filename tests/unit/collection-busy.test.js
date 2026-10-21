import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

function load() {
  const events = [];
  const document = { dispatchEvent: (e) => events.push({ type: e.type, id: e.detail.collectionId }) };
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const window = {};
  const src = fs.readFileSync(path.join(import.meta.dirname, '../../src/renderer/collection-busy.js'), 'utf8');
  vm.runInNewContext(src, { window, document, CustomEvent });
  return { busy: window.CollectionBusy, events };
}

describe('CollectionBusy', () => {
  it('tracks busy per collection and fires one event per begin and per end', () => {
    const { busy, events } = load();
    expect(busy.isBusy('a')).toBe(false);
    busy.begin('a');
    expect(busy.isBusy('a')).toBe(true);
    expect(busy.isBusy('b')).toBe(false);
    busy.end('a');
    expect(busy.isBusy('a')).toBe(false);
    expect(events).toEqual([
      { type: 'collection-busy-changed', id: 'a' },
      { type: 'collection-busy-changed', id: 'a' },
    ]);
  });

  it('fires nothing for a repeated begin or an end without a begin', () => {
    const { busy, events } = load();
    expect(busy.end('a')).toBe(false);
    expect(busy.begin('a')).toBe(true);
    expect(busy.begin('a')).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('holder returns the kind passed to begin, null when idle or no kind was given', () => {
    const { busy } = load();
    expect(busy.holder('a')).toBeNull();
    busy.begin('a', 'add-folder');
    busy.begin('b');
    expect(busy.holder('a')).toBe('add-folder');
    expect(busy.holder('b')).toBeNull();
    busy.end('a');
    expect(busy.holder('a')).toBeNull();
    expect(busy.begin('a', 'rescan')).toBe(true);
    expect(busy.holder('a')).toBe('rescan');
  });
});
