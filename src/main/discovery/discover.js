'use strict';

/*
 * Discovery (FR-5..FR-8). Read-only walk of a folder at any depth.
 *
 *   discoverSync(folderPath, options?)  -> FileRecord[]
 *
 * options.onError(err, path): called for each subdirectory that cannot be
 * read; that subtree is skipped and the scan continues. An unreadable
 * folderPath itself throws (callers mark the folder unavailable, FR-4).
 *
 * Record (storage FileRecord minus folderId/collectionId):
 *   { path (absolute), relativePath ("/" separated), name, extension
 *     (lower-case, no dot), kind, subtype? }
 * Output is sorted by relativePath (code-unit order) and is deterministic.
 *
 * Rules: extensions matched case-insensitively via the registry; names
 * starting with "." are skipped (files, and folders with their contents);
 * package directories (see packages.js) are not entered; symlinks are neither
 * followed nor indexed (entries come from readdir withFileTypes, which does
 * not stat through links). Nothing is created or modified.
 *
 * Pure Node (no Electron), so it can run in a worker thread.
 */

const fs = require('node:fs');
const path = require('node:path');
const { lookupFileName } = require('../registry/types.js');
const { isPackageName } = require('./packages.js');

/**
 * Decide what to do with a directory entry: 'dir', the registry entry of a
 * recognized file (one lookup per file), or null (skip).
 */
function classify(entry) {
  if (entry.name.startsWith('.')) return null;
  if (entry.isSymbolicLink()) return null;
  if (entry.isDirectory()) return isPackageName(entry.name) ? null : 'dir';
  if (entry.isFile()) return lookupFileName(entry.name) || null;
  return null;
}

function makeRecord(absPath, relativePath, name, info) {
  const record = {
    path: absPath,
    relativePath,
    name,
    extension: info.extension,
    kind: info.kind,
  };
  if (info.subtype) record.subtype = info.subtype;
  return record;
}

function byRelativePath(a, b) {
  if (a.relativePath < b.relativePath) return -1;
  return a.relativePath > b.relativePath ? 1 : 0;
}

function resolveRoot(folderPath) {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) {
    throw new TypeError('discoverSync: folderPath must be an absolute path');
  }
  return path.resolve(folderPath);
}

function discoverSync(folderPath, options = {}) {
  const root = resolveRoot(folderPath);
  const records = [];
  const walk = (dir, rel, isRoot) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (isRoot) throw err;
      if (options.onError) options.onError(err, dir);
      return;
    }
    for (const entry of entries) {
      const found = classify(entry);
      if (!found) continue;
      const abs = path.join(dir, entry.name);
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (found === 'dir') walk(abs, entryRel, false);
      else records.push(makeRecord(abs, entryRel, entry.name, found));
    }
  };
  walk(root, '', true);
  return records.sort(byRelativePath);
}

module.exports = { discoverSync };
