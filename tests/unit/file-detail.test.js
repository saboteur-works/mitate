import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { describeSelection } = require('../../src/shared/file-detail.js');

describe('describeSelection', () => {
  it('returns a short path exactly', () => {
    const r = describeSelection({ path: '/Volumes/Media/a.jpg' });
    expect(r.pathText).toBe('/Volumes/Media/a.jpg');
  });

  it('returns a path over 300 characters in full, without ellipsis', () => {
    const p = '/Volumes/Media/' + 'dir/'.repeat(100) + 'file.jpg';
    expect(p.length).toBeGreaterThan(300);
    const r = describeSelection({ path: p });
    expect(r.pathText.length).toBe(p.length);
    expect(r.pathText).toBe(p);
    expect(r.pathText).not.toMatch(/…|\.\.\./);
  });

  it('null selection: empty path, empty-state text, reveal disabled', () => {
    const r = describeSelection(null);
    expect(r.pathText).toBe('');
    expect(r.emptyText.length).toBeGreaterThan(0);
    expect(r.revealDisabled).toBe(true);
  });

  it('selected file enables reveal', () => {
    expect(describeSelection({ path: '/a/b.jpg' }).revealDisabled).toBe(false);
  });

  it('unavailable file still returns its path and enables reveal', () => {
    const r = describeSelection({ path: '/a/b.jpg', unavailable: true });
    expect(r.pathText).toBe('/a/b.jpg');
    expect(r.revealDisabled).toBe(false);
  });

  it('a folder entry behaves as no selection', () => {
    const r = describeSelection({ type: 'folder', path: '/a' });
    expect(r.pathText).toBe('');
    expect(r.emptyText.length).toBeGreaterThan(0);
    expect(r.revealDisabled).toBe(true);
  });
});
