'use strict';

/*
 * Collection service (FR-1, FR-2, FR-3, FR-4, FR-6, FR-7, FR-8, FR-11, FR-12, FR-13). Main-process logic with
 * no Electron imports: the storage instance and the scan function are injected
 * so it can be unit-tested and wired by IPC.
 *
 *   createCollectionService({ storage, scan = runScan, idGenerator?, guard?, confirm? })
 *     storage:     an openStorage() instance
 *     scan:        async (absoluteFolderPath) -> FileRecord[]; rejects when the
 *                  folder cannot be read
 *     idGenerator: () -> string (default crypto.randomUUID)
 *     guard:       an in-flight guard (in-flight.js); default: the service's own.
 *                  Pass the guard shared with the rescan service so the two
 *                  exclude each other.
 *     confirm:     async (request) -> boolean; default none (no confirmation
 *                  is ever granted); used by createCollection, deleteCollection and addFolder.
 *
 *   createCollection(name, directories) -> Promise<{collection, folders, files} | {canceled: true}>
 *                                          (picked folders that overlap each other need
 *                                          confirm === true, before any scan)
 *   loadCollections()                   -> Promise<Array<{collection, folders, files}>>
 *                                          (listCollectionSummaries, then a view per collection)
 *   listCollectionSummaries()           -> Promise<Array<{id, name, folderCount,
 *                                          folders: [{id, path, unavailable}]}>>
 *                                          (no file records; index not read)
 *   getCollectionView(collectionId)     -> {collection, folders, files} | null
 *                                          (files read per folder, in folder order)
 *   renameCollection(id, name)          -> Promise<{collection, folders, files}>
 *                                          (name trimmed; duplicates and any length accepted)
 *   addFolder(collectionId, dirPath)    -> Promise<{collection, folders, files} | {canceled: true}>
 *                                          (guard kind 'add-folder', held across validation,
 *                                          confirmation and the scan of the new folder only;
 *                                          overlap with the collection's folders needs
 *                                          confirm === true; one storage.transaction)
 *   removeFolder(collectionId, folderId) -> Promise<{collection, folders, files}>
 *                                          (the refreshed view; rejects with code
 *                                          'LAST_FOLDER' for the only folder)
 *   deleteCollection(id)                -> Promise<{deleted: true} | {canceled: true}>
 *                                          (guard kind 'delete', held across the confirmation;
 *                                          store only, never touches the file system)
 *   findIndexedFile(filePath)           -> stored file record | null
 *                                          (record whose path equals filePath exactly;
 *                                          no normalization, no file system access)
 *   collectionView(storage, collectionId)  (exported) the pure function behind
 *                                          getCollectionView; rescan.js uses it too
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
 *   by realpath). The service only reads collection folders (stat, opendir,
 *   scan); it never writes there.
 * - FR-1 / OQ-10 at creation: each folder must pass the readability check
 *   (a directory that can be opened for listing; see folder-access.js), or
 *   creation is rejected with an error naming the folder and the error code
 *   and nothing is stored. A folder that passes it but whose scan then fails
 *   (e.g. the drive disconnects mid-scan) is stored with unavailable: true
 *   and an empty index (FR-4).
 * - loadCollections and listCollectionSummaries never scan and never show a
 *   picker (FR-3). Every folder of every collection gets the readability check
 *   (concurrently); flags that differ from the stored ones are persisted in
 *   one storage.transaction (one write, FR-18).
 *   Folder records and indexed files are never removed.
 * - FR-11 / FR-12: renameCollection and removeFolder acquire the guard for
 *   the collection (kind 'rename' / 'remove-folder') and reject with
 *   code 'COLLECTION_BUSY' when it is held; other collections are unaffected.
 *   The guard is released in a finally. Each applies its change in one
 *   storage.transaction (one write, FR-18). removeFolder refuses a folder that
 *   belongs to another collection and the collection's last folder (FR-4);
 *   it never touches the file system.
 * - The file-level `unavailable` flag is DERIVED, not persisted: returned
 *   file records carry unavailable: true when their folder is unavailable, and
 *   the flag is absent when it is available. The folder record is the single
 *   persisted source of truth.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createInFlightGuard } = require('./in-flight.js');
const { findOverlaps, describeOverlap } = require('./overlap.js');
const { defaultScan, checkReadableDirectory, isReadableDirectory, scanFolder } = require('./folder-access.js');

async function assertDirectory(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    throw new Error(`Folder path must be an absolute path: ${String(dir)}`);
  }
  const problem = await checkReadableDirectory(dir);
  if (problem) throw new Error(problem.message);
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
  while (dir !== path.dirname(dir) && !fs.existsSync(dir)) {
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

// The stored view of one collection, or null when it does not exist. File
// records of an unavailable folder carry unavailable: true; the flag is
// derived from the folder record, never read from the stored file record.
function collectionView(storage, collectionId) {
  const collection = storage.getCollection(collectionId);
  if (!collection) return null;
  const folders = storage.listFolders(collectionId);
  const files = folders.flatMap((folder) =>
    storage.getIndex({ folderId: folder.id }).map((f) => {
      const { unavailable, ...rest } = f;
      return folder.unavailable ? { ...rest, unavailable: true } : rest;
    }));
  return { collection, folders, files };
}

function createCollectionService({
  storage,
  scan = defaultScan,
  idGenerator = crypto.randomUUID,
  guard = createInFlightGuard(),
  confirm = null,
} = {}) {
  if (!storage) throw new Error('storage is required');

  async function validate(name, directories) {
    if (typeof name !== 'string' || name.trim() === '') throw new Error('Collection name must not be empty');
    if (!Array.isArray(directories) || directories.length === 0) {
      throw new Error('At least one folder is required');
    }
    return { name: name.trim(), dirs: await validateDirectories(directories) };
  }

  // The checks creation and add share: each path absolute, a readable
  // directory, and not containing the storage file. Returns the resolved,
  // de-duplicated paths.
  async function validateDirectories(directories) {
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
    return unique;
  }

  // FR-8 at creation: the first overlapping pair among the picked folders
  // (in pick order), worded by describeOverlap, plus a count of the other
  // overlapping pairs. null when no two folders overlap.
  function describeCreationOverlap(dirs) {
    const lines = [];
    for (let j = 1; j < dirs.length; j++) {
      for (let i = 0; i < j; i++) {
        const line = describeOverlap(findOverlaps(dirs[j], [dirs[i]]), dirs[j]);
        if (line) lines.push(line);
      }
    }
    if (lines.length === 0) return null;
    const others = lines.length - 1;
    return others === 0 ? lines[0] : `${lines[0]} (and ${others} other overlapping ${others === 1 ? 'pair' : 'pairs'}.)`;
  }

  async function createCollection(name, directories) {
    const { name: cleanName, dirs } = await validate(name, directories);
    const overlap = describeCreationOverlap(dirs);
    if (overlap) {
      const confirmed = typeof confirm === 'function' && (await confirm({
        title: 'Create collection',
        message: `Create "${cleanName}" with overlapping folders?`,
        detail: `${overlap} `
          + 'No files on disk are touched, deleted or moved.',
        confirmLabel: 'Create collection',
      }));
      if (confirmed !== true) return { canceled: true };
    }
    const collectionId = idGenerator();
    const scanned = [];
    for (const dir of dirs) scanned.push({ id: idGenerator(), dir, ...(await scanFolder(scan, dir)) });

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
    return collectionView(storage, collectionId);
  }

  // Checks every folder of every collection concurrently, then applies all
  // flag changes in one transaction (one write, FR-18).
  async function refreshAccessibility(collections) {
    const folders = collections.flatMap((c) => storage.listFolders(c.id));
    const checked = await Promise.all(
      folders.map(async (folder) => ({ folder, ok: await isReadableDirectory(folder.path) })));
    const changes = checked.filter(({ folder, ok }) => folder.unavailable === ok);
    if (changes.length === 0) return;
    storage.transaction(() => {
      for (const { folder, ok } of changes) storage.setFolderUnavailable(folder.id, !ok);
    });
  }

  // Summaries for the collection list: no file records, and the index is not
  // read. Runs the accessibility check first.
  async function listCollectionSummaries() {
    const collections = storage.listCollections();
    await refreshAccessibility(collections);
    return collections.map((collection) => {
      const folders = storage.listFolders(collection.id).map(({ id, path: folderPath, unavailable }) => ({
        id,
        path: folderPath,
        unavailable,
      }));
      return { id: collection.id, name: collection.name, folderCount: folders.length, folders };
    });
  }

  async function loadCollections() {
    return (await listCollectionSummaries()).map((s) => getCollectionView(s.id));
  }

  function getCollectionView(collectionId) {
    return collectionView(storage, collectionId);
  }

  // The stored record whose path equals filePath exactly, or null. Reads the
  // index only: no path normalization and no file system access.
  function findIndexedFile(filePath) {
    return storage.getIndex().find((record) => record.path === filePath) || null;
  }

  // Runs fn while holding the guard for the collection; busy -> COLLECTION_BUSY.
  async function withGuard(collectionId, kind, fn) {
    const release = guard.acquire(collectionId, kind);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  function requireCollection(collectionId) {
    const collection = storage.getCollection(collectionId);
    if (!collection) throw new Error(`Unknown collection: ${String(collectionId)}`);
    return collection;
  }

  async function renameCollection(collectionId, name) {
    return withGuard(collectionId, 'rename', () => {
      const collection = requireCollection(collectionId);
      if (typeof name !== 'string' || name.trim() === '') throw new Error('Collection name must not be empty');
      storage.transaction(() => storage.putCollection({ ...collection, name: name.trim() }));
      return collectionView(storage, collectionId);
    });
  }

  async function removeFolder(collectionId, folderId) {
    return withGuard(collectionId, 'remove-folder', () => {
      const collection = requireCollection(collectionId);
      const folder = storage.getFolder(folderId);
      if (!folder || folder.collectionId !== collectionId) {
        throw new Error(`Folder ${String(folderId)} does not belong to this collection`);
      }
      if (storage.listFolders(collectionId).length <= 1) {
        const err = new Error(
          `Cannot remove the last folder of "${collection.name}"; delete the collection instead`);
        err.code = 'LAST_FOLDER';
        throw err;
      }
      storage.transaction(() => {
        storage.replaceFolderIndex(folderId, []);
        storage.removeFolder(folderId);
      });
      return collectionView(storage, collectionId);
    });
  }

  // FR-2 / FR-4: removes the collection, its folders, indexes and access data
  // from the store only. The guard is held from before the confirmation so a
  // rescan or edit cannot interleave while the dialog is open.
  async function deleteCollection(collectionId) {
    return withGuard(collectionId, 'delete', async () => {
      const collection = requireCollection(collectionId);
      const confirmed = typeof confirm === 'function' && (await confirm({
        title: 'Delete collection',
        message: `Delete the collection "${collection.name}"?`,
        detail: 'Only the collection and its index are removed from Mitate. '
          + 'No files on disk are touched, deleted or moved.',
        confirmLabel: 'Delete collection',
      }));
      if (confirmed !== true) return { canceled: true };
      storage.transaction(() => storage.removeCollection(collectionId));
      return { deleted: true };
    });
  }

  // FR-6 / FR-7 / FR-8: adds one folder to a collection. The guard is held from
  // before the validation, across the confirmation and the scan of the new
  // folder only. Overlap with the collection's existing folders needs
  // confirm === true; otherwise nothing is scanned or stored.
  async function addFolder(collectionId, dirPath) {
    return withGuard(collectionId, 'add-folder', async () => {
      const collection = requireCollection(collectionId);
      const [dir] = await validateDirectories([dirPath]);
      const existing = storage.listFolders(collectionId).map((f) => f.path);
      const line = describeOverlap(findOverlaps(dir, existing), dir);
      if (line) {
        const confirmed = typeof confirm === 'function' && (await confirm({
          title: 'Add folder',
          message: `Add this folder to "${collection.name}"?`,
          detail: `${line} Files already indexed in the collection may be listed more than once. `
            + 'No files on disk are touched, deleted or moved.',
          confirmLabel: 'Add folder',
        }));
        if (confirmed !== true) return { canceled: true };
      }
      const scanned = await scanFolder(scan, dir);
      const folderId = idGenerator();
      const folderIds = [...(collection.folderIds || []).filter((id) => id !== folderId), folderId];
      storage.transaction(() => {
        storage.putFolder({ id: folderId, collectionId, path: dir, unavailable: scanned.unavailable });
        storage.replaceFolderIndex(folderId, scanned.records);
        storage.putCollection({ ...collection, folderIds });
      });
      return collectionView(storage, collectionId);
    });
  }

  return { createCollection, addFolder, renameCollection, removeFolder, deleteCollection, loadCollections, listCollectionSummaries, getCollectionView, findIndexedFile };
}

module.exports = { createCollectionService, collectionView };
