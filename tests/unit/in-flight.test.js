import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { createInFlightGuard } = require('../../src/main/collections/in-flight.js');

describe('createInFlightGuard', () => {
  it('acquire returns a release function', () => {
    const guard = createInFlightGuard();
    expect(typeof guard.acquire('a', 'rescan')).toBe('function');
  });

  it('a second acquire of the same id throws COLLECTION_BUSY naming the holding kind', () => {
    const guard = createInFlightGuard();
    guard.acquire('a', 'add-folder');
    let err;
    try { guard.acquire('a', 'rescan'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('COLLECTION_BUSY');
    expect(err.message).toContain('add-folder');
  });

  it('acquire for a different id succeeds', () => {
    const guard = createInFlightGuard();
    guard.acquire('a', 'rescan');
    expect(() => guard.acquire('b', 'rescan')).not.toThrow();
  });

  it('release makes the id acquirable again; releasing twice is harmless', () => {
    const guard = createInFlightGuard();
    const release = guard.acquire('a', 'rescan');
    release();
    expect(() => release()).not.toThrow();
    expect(() => guard.acquire('a', 'add-folder')).not.toThrow();
  });

  it('a stale release does not free a later holder', () => {
    const guard = createInFlightGuard();
    const first = guard.acquire('a', 'rescan');
    first();
    guard.acquire('a', 'add-folder');
    first();
    expect(guard.isBusy('a')).toBe(true);
    expect(guard.holder('a')).toBe('add-folder');
  });

  it('isBusy reflects state', () => {
    const guard = createInFlightGuard();
    expect(guard.isBusy('a')).toBe(false);
    const release = guard.acquire('a', 'rescan');
    expect(guard.isBusy('a')).toBe(true);
    expect(guard.isBusy('b')).toBe(false);
    release();
    expect(guard.isBusy('a')).toBe(false);
  });
});
