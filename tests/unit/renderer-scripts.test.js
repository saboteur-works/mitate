import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// The renderer loads src/shared/*.js as classic <script>s that share one global
// lexical scope. A top-level `const X` in two of them throws on the second load
// and leaves its global undefined, so run them as the page does, in one context.
const rendererDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer');
const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const shared = [...html.matchAll(/<script src="(\.\.\/shared\/[^"]+)"/g)].map((m) => m[1]);

describe('shared scripts loaded by index.html', () => {
  it('lists the shared scripts', () => {
    expect(shared).toContain('../shared/path-compare.js');
    expect(shared).toContain('../shared/tree-model.js');
    expect(shared).toContain('../shared/type-list.js');
    expect(shared).toContain('../shared/type-list-cache.js');
    expect(shared).toContain('../shared/list-window.js');
    expect(shared).toContain('../shared/tabs-model.js');
  });

  it('load together in one global scope and define their globals', () => {
    const ctx = vm.createContext({});
    for (const rel of shared) {
      const file = path.join(rendererDir, rel);
      vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
    }
    expect(vm.runInContext('typeof PathCompare', ctx)).toBe('object');
    expect(vm.runInContext('typeof TreeModel', ctx)).toBe('object');
    expect(vm.runInContext('typeof FileDetail', ctx)).toBe('object');
    expect(vm.runInContext('typeof TypeList', ctx)).toBe('object');
    expect(vm.runInContext('typeof TypeListCache', ctx)).toBe('object');
    expect(vm.runInContext('typeof ListWindow', ctx)).toBe('object');
    expect(vm.runInContext('typeof TabsModel', ctx)).toBe('object');
  });
});
