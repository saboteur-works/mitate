import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const file = require.resolve('../../src/shared/path-compare.js');
const { normalize, isSame, isInside, contains, compare } = require(file);

describe('path-compare', () => {
  it('/a/b/c is inside /a/b and /a/b contains /a/b/c', () => {
    expect(isInside('/a/b/c', '/a/b')).toBe(true);
    expect(contains('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/b/c')).toBe(false);
    expect(contains('/a/b/c', '/a/b')).toBe(false);
  });

  it('unrelated paths relate in no way', () => {
    expect(compare('/a/b', '/c/d')).toEqual({ same: false, inside: false, contains: false });
  });

  it('matches whole segments only', () => {
    expect(isInside('/a/bc', '/a/b')).toBe(false);
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(contains('/a/b', '/a/bc')).toBe(false);
  });

  it('ignores a trailing slash', () => {
    expect(isSame('/a/b/', '/a/b')).toBe(true);
    expect(normalize('/a/b/')).toBe('/a/b');
  });

  it('is case-sensitive: callers canonicalise the case first', () => {
    expect(isSame('/A/B', '/a/b')).toBe(false);
    expect(isInside('/A/B/c', '/a/b')).toBe(false);
    expect(compare('/A/B', '/a/b/c')).toEqual({ same: false, inside: false, contains: false });
    expect(isSame('/A/B/', '/A//B/./')).toBe(true);
  });

  it('collapses repeated separators and . segments', () => {
    expect(normalize('/a//b/./c')).toBe('/a/b/c');
    expect(isSame('/a//b/./c', '/a/b/c')).toBe(true);
  });

  it('resolves .. segments and never rises above the root', () => {
    expect(normalize('/a/b/../c')).toBe('/a/c');
    expect(normalize('/../..')).toBe('/');
  });

  it('root contains every path and is inside none but itself', () => {
    expect(contains('/', '/a')).toBe(true);
    expect(contains('/', '/a/b/c')).toBe(true);
    expect(isInside('/', '/a')).toBe(false);
    expect(isSame('/', '/')).toBe(true);
    expect(isInside('/', '/')).toBe(false);
    expect(contains('/', '/')).toBe(false);
    expect(isSame('//', '/')).toBe(true);
  });

  it('identical paths are same and not inside or containing', () => {
    expect(compare('/a/b', '/a/b')).toEqual({ same: true, inside: false, contains: false });
  });

  it('answers false and null for relative or non-string input', () => {
    expect(normalize('a/b')).toBeNull();
    expect(normalize('')).toBeNull();
    expect(normalize(undefined)).toBeNull();
    expect(compare('a/b', '/a/b')).toEqual({ same: false, inside: false, contains: false });
    expect(isSame('', '')).toBe(false);
  });

  it('exports through module.exports under Node', () => {
    expect(typeof require(file).compare).toBe('function');
  });

  it('exports as globalThis.PathCompare when module is undefined', () => {
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
    expect(typeof vm.runInContext('typeof module', ctx)).toBe('string');
    expect(vm.runInContext('typeof module', ctx)).toBe('undefined');
    expect(vm.runInContext('PathCompare.isInside("/a/b/c", "/a/b")', ctx)).toBe(true);
    expect(Object.keys(vm.runInContext('PathCompare', ctx)).sort()).toEqual(
      ['compare', 'contains', 'isInside', 'isSame', 'normalize']
    );
  });
});
