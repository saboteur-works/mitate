import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const { KINDS, lookupExtension, lookupFileName, listByKind, listAll } = require('../../src/main/registry/types.js');

const FR10 = {
  image: ['jpeg', 'jpg', 'png', 'gif', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'webp', 'avif', 'psd', 'exr', 'tga'],
  raw: ['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', 'iiq', '3fr'],
  audio: ['mp3', 'aac', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aiff', 'aif', 'wma'],
  video: ['mp4', 'mov', 'm4v', '3gp', 'mkv', 'webm', 'mpg', 'dv', 'wmv', 'avi', 'flv'],
  document: ['pdf', 'txt', 'epub', 'cbz'],
};

describe('registry', () => {
  it('registers exactly the FR-10 extension set', () => {
    const expected = Object.values(FR10).flat().sort();
    const actual = listAll().map((e) => e.extension).sort();
    expect(actual).toEqual(expected);
  });

  it('has no duplicate extension', () => {
    const exts = listAll().map((e) => e.extension);
    expect(new Set(exts).size).toBe(exts.length);
  });

  it('gives each entry exactly one valid kind and a lowercase extension', () => {
    for (const e of listAll()) {
      expect(KINDS.filter((k) => k === e.kind)).toHaveLength(1);
      expect(e.extension).toBe(e.extension.toLowerCase());
    }
  });

  it('maps each FR-10 extension to its kind', () => {
    for (const ext of FR10.image) expect(lookupExtension(ext).kind).toBe('image');
    for (const ext of FR10.audio) expect(lookupExtension(ext).kind).toBe('audio');
    for (const ext of FR10.video) expect(lookupExtension(ext).kind).toBe('video');
    for (const ext of FR10.document) expect(lookupExtension(ext).kind).toBe('document');
  });

  it('marks RAW entries as kind image with subtype RAW, and only those', () => {
    for (const ext of FR10.raw) {
      expect(lookupExtension(ext)).toMatchObject({ kind: 'image', subtype: 'RAW' });
    }
    const withSubtype = listAll().filter((e) => e.subtype !== undefined).map((e) => e.extension).sort();
    expect(withSubtype).toEqual([...FR10.raw].sort());
  });

  it('does not register formats pending product FR-23', () => {
    for (const ext of ['jxl', 'caf', 'ac3', 'ts', 'mts', 'm2ts']) {
      expect(lookupExtension(ext)).toBeUndefined();
    }
  });

  it('lists entries by kind, covering every entry once', () => {
    const lists = KINDS.map((k) => listByKind(k));
    expect(lists.flat()).toHaveLength(listAll().length);
    expect(listByKind('image').map((e) => e.extension).sort()).toEqual([...FR10.image, ...FR10.raw].sort());
    expect(listByKind('document').map((e) => e.extension).sort()).toEqual([...FR10.document].sort());
    expect(() => listByKind('archive')).toThrow();
  });

  it('looks up file names case-insensitively', () => {
    expect(lookupFileName('A.JPG')).toBe(lookupExtension('jpg'));
    expect(lookupFileName('shot.Cr3')).toMatchObject({ kind: 'image', subtype: 'RAW' });
    expect(lookupFileName('a.b.MP3').kind).toBe('audio');
  });

  it('returns undefined for unsupported, extensionless or hidden-only names', () => {
    expect(lookupFileName('movie.TS')).toBeUndefined();
    expect(lookupFileName('README')).toBeUndefined();
    expect(lookupFileName('.jpg')).toBeUndefined();
    expect(lookupFileName('trailing.')).toBeUndefined();
    expect(lookupFileName(null)).toBeUndefined();
    expect(lookupExtension('JPG')).toBeUndefined();
  });
});
