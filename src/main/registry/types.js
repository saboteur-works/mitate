'use strict';

// Supported-type registry (FR-9, FR-10): the single data table of indexed
// extensions. It says what is indexed, not what can be previewed or played.

const KINDS = Object.freeze(['image', 'audio', 'video', 'document']);

const RAW_EXTENSIONS = ['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', 'iiq', '3fr'];

// One row per extension: [extension, kind, subtype | undefined].
const TABLE = [
  ...['jpeg', 'jpg', 'png', 'gif', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'webp', 'avif', 'psd', 'exr', 'tga']
    .map((ext) => [ext, 'image']),
  ...RAW_EXTENSIONS.map((ext) => [ext, 'image', 'RAW']),
  ...['mp3', 'aac', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aiff', 'aif', 'wma'].map((ext) => [ext, 'audio']),
  ...['mp4', 'mov', 'm4v', '3gp', 'mkv', 'webm', 'mpg', 'dv', 'wmv', 'avi', 'flv'].map((ext) => [ext, 'video']),
  ...['pdf', 'txt', 'epub', 'cbz'].map((ext) => [ext, 'document']),
];

const ENTRIES = new Map();
for (const [extension, kind, subtype] of TABLE) {
  if (ENTRIES.has(extension)) {
    throw new Error(`Duplicate extension in registry: ${extension}`);
  }
  const entry = subtype ? { extension, kind, subtype } : { extension, kind };
  ENTRIES.set(extension, Object.freeze(entry));
}

/** Entry for a lowercase extension without the dot, or undefined. */
function lookupExtension(extension) {
  if (typeof extension !== 'string') return undefined;
  return ENTRIES.get(extension);
}

/** Entry for a file name (any case, e.g. "A.JPG"), or undefined. */
function lookupFileName(fileName) {
  if (typeof fileName !== 'string') return undefined;
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return undefined;
  return ENTRIES.get(fileName.slice(dot + 1).toLowerCase());
}

/** Entries of one kind; throws on an unknown kind. */
function listByKind(kind) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown media kind: ${kind}`);
  return [...ENTRIES.values()].filter((entry) => entry.kind === kind);
}

/** All entries, in table order. */
function listAll() {
  return [...ENTRIES.values()];
}

module.exports = { KINDS, lookupExtension, lookupFileName, listByKind, listAll };
