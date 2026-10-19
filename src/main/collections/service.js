'use strict';

/*
 * Collection service (FR-1, FR-2, FR-3, FR-4, FR-13). Main-process logic with
 * no Electron imports: the storage instance and the scan function are injected
 * so it can be unit-tested and wired by IPC.
 *
 *   createCollectionService({ storage, scan = runScan, idGenerator? })
 *     storage:     an openStorage() instance
 *     scan:        async (absoluteFolderPath) -> FileRecord[]; rejects when the
 *                  folder cannot be read
 *     idGenerator: () -> string (default crypto.randomUUID)
 *
 *   createCollection(name, directories) -> Promise<{collection, folders, files}>
 *   loadCollections()                   -> Promise<Array<{collection, folders, files}>>
 *   listCollectionSummaries()           -> Promise<Array<{id, name, folderCount,
 *                                          folders: [{id, path, unavailable}]}>>
 *                                          (no file records; index not read)
 *   getCollectionView(collectionId)     -> {collection, folders, files} | null
 *                                          (files read per folder, in folder order)
 *
 * Decisions:
 * - Validation happens before anything is scanned or stored: name must be
 *   non-blank; directories non-empty; each path absolute and an existing
 *   directory (files, missing and relative paths are rejected); duplicates
 *   (after path.resolve) are collapsed.
 * - FR-18: createCollection awaits every scan first, then stores the
 *   collection, its folders, their indexes and unavailable flags inside one
 *   storage.transaction, i.e. one write of the store regardless of folder count.
 * - FR-13: a directory that contains the storage file is rejected (compared
 *   by realpath). The service only reads collection folders (stat, access,
 *   scan); it never writes there.
 * - FR-4 at creation: a directory that passes validation but fails to scan
 *   (e.g. no read permission) is stored as a folder record with
 *   unavailable: true and an empty index; creation does not fail.
 * - loadCollections never scans and never shows a picker (FR-3). Each folder
 *   is checked as a directory with fs.access(R_OK); the result is persisted
 *   with setFolderUnavailable only when it differs from the stored flag.
 *   Folder records and indexed files are never removed.
 * - The file-level `unavailable` flag is DERIVED, not persisted: returned
 *   file records carry unavailable: true when their folder is unavailable, and
 *   the flag is absent when it is available. The folder record is the single
 *   persisted source of truth.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function defaultScan(folderPath) {
  return require('../discovery/run-scan.js').runScan(folderPath);
}

async function assertDirectory(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    throw new Error(`Folder path must be an absolute path: ${String(dir)}`);
  }
  let stat;
  try {
    stat = await fs.promises.stat(dir);
  } catch (err) {
    throw new Error(`Folder does not exist or cannot be read: ${dir} (${err.code || err.message})`);
  }
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${dir}`);
}

async function realOrSelf(p) {
  try {
    return await fs.promises.realpath(p);
  } catch {
    return p;
  }
}

async function resolvedStorageFile(storage) {
  const file = storage.getLocation();
  // The store file may not exist yet; resolve its directory (or nearest existing ancestor).
  let dir = path.dirname(file);
  const tail = [path.basename(file)];
  while (dir !== path.dirname(dir) && (await realOrSelf(dir)) === dir && !fs.existsSync(dir)) {
    tail.unshift(path.basename(dir));
    dir = path.dirname(dir);
  }
  return path.join(await realOrSelf(dir), ...tail);
}

function contains(dir, file) {
  const rel = path.relative(dir, file);
  // Only '..' itself or '..' + separator escapes dir; a child named '..x' is inside.
  const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  return !outside;
}

async function isReadableDirectory(dir) {
  try {
    const stat = await fs.promises.stat(dir);
    if (!stat.isDirectory()) return false;
    await fs.promises.access(dir, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function createCollectionService({ storage, scan = defaultScan, idGenerator = crypto.randomUUID } = {}) {
  if (!storage) throw new Error('storage is required');

  function view(collection) {
    const folders = storage.listFolders(collection.id);
    const files = folders.flatMap((folder) =>
      storage.getIndex({ folderId: folder.id }).map((f) => {
        const { unavailable, ...rest } = f;
        return folder.unavailable ? { ...rest, unavailable: true } : rest;
      }));
    return { collection, folders, files };
  }

  async function validate(name, directories) {
    if (typeof name !== 'string' || name.trim() === '') throw new Error('Collection name must not be empty');
    if (!Array.isArray(directories) || directories.length === 0) {
      throw new Error('At least one folder is required');
    }
    const unique = [];
    for (const dir of directories) {
      await assertDirectory(dir);
      const resolved = path.resolve(dir);
      if (!unique.includes(resolved)) unique.push(resolved);
    }
    const storageFile = await resolvedStorageFile(storage);
    for (const dir of unique) {
      if (contains(await realOrSelf(dir), storageFile)) {
        throw new Error(`Folder contains the app storage location, which must be outside collection folders: ${dir}`);
      }
    }
    return { name: name.trim(), dirs: unique };
  }

  async function scanOne(dir) {
    try {
      return { records: await scan(dir), unavailable: false };
    } catch {
      return { records: [], unavailable: true };
    }
  }

  async function createCollection(name, directories) {
    const { name: cleanName, dirs } = await validate(name, directories);
    const collectionId = idGenerator();
    const scanned = [];
    for (const dir of dirs) scanned.push({ id: idGenerator(), dir, ...(await scanOne(dir)) });

    // All awaits are done; apply every record in one synchronous transaction so
    // the store is written once (FR-18) and a failure leaves nothing behind.
    storage.transaction(() => {
      storage.putCollection({
        id: collectionId,
        name: cleanName,
        folderIds: scanned.map((s) => s.id),
        createdAt: new Date().toISOString(),
      });
      for (const s of scanned) {
        storage.putFolder({ id: s.id, collectionId, path: s.dir, unavailable: s.unavailable });
        storage.replaceFolderIndex(s.id, s.records);
      }
    });
    return view(storage.getCollection(collectionId));
  }

  async function refreshAccessibility(collectionId) {
    for (const folder of storage.listFolders(collectionId)) {
      const ok = await isReadableDirectory(folder.path);
      if (folder.unavailable === ok) storage.setFolderUnavailable(folder.id, !ok);
    }
  }

  async function loadCollections() {
    const result = [];
    for (const collection of storage.listCollections()) {
      await refreshAccessibility(collection.id);
      result.push(view(collection));
    }
    return result;
  }

  // Summaries for the collection list: no file records, and the index is not
  // read. Runs the same accessibility check as loadCollections.
  async function listCollectionSummaries() {
    const result = [];
    for (const collection of storage.listCollections()) {
      await refreshAccessibility(collection.id);
      const folders = storage.listFolders(collection.id).map(({ id, path: folderPath, unavailable }) => ({
        id,
        path: folderPath,
        unavailable,
      }));
      result.push({ id: collection.id, name: collection.name, folderCount: folders.length, folders });
    }
    return result;
  }

  function getCollectionView(collectionId) {
    const collection = storage.getCollection(collectionId);
    return collection ? view(collection) : null;
  }

  return { createCollection, loadCollections, listCollectionSummaries, getCollectionView };
}

module.exports = { createCollectionService, defaultScan, isReadableDirectory };
