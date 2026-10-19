'use strict';

/*
 * Rescan service (FR-20, FR-4, FR-13). Main-process logic with no Electron
 * imports; storage and the scan function are injected.
 *
 *   createRescanService({ storage, scan = runScan })
 *     rescanCollection(collectionId)
 *       -> Promise<{collection, folders, files, summary: {rescanned, skipped}}>
 *          Rejects with an Error whose `code === RESCAN_IN_PROGRESS` when a rescan
 *          of the same collection is already running (see below).
 *
 * Decisions:
 * - The view part has the same shape as collectionService.getCollectionView
 *   (it is produced by that function; file-level `unavailable` is derived from
 *   the folder flag).
 * - A folder that is not an accessible directory is skipped: its stored files
 *   and record are untouched except that the folder is flagged unavailable.
 * - An available folder is scanned and its index replaced. After a successful
 *   scan the folder's state is re-read from storage (the snapshot taken before
 *   the await may be stale) and the unavailable flag is cleared only if the
 *   re-read state says unavailable. If the folder was removed from storage
 *   while the scan ran, nothing is written and it is reported in
 *   `summary.skipped`. If the scan rejects, the folder is flagged unavailable,
 *   its stored files are kept, and it is reported in `skipped`.
 * - In-flight rescans are tracked per collection id. A second rescanCollection
 *   of the same collection while the first is pending rejects at once with an
 *   Error (code RESCAN_IN_PROGRESS) and does not run discovery; a rescan of a
 *   different collection is not blocked. The marker is cleared in a finally,
 *   so it is released on success and on failure.
 * - Launch behaviour ("show the stored index without scanning") is
 *   loadCollections in service.js; nothing here runs on launch.
 * - Only reads collection folders (stat, access, scan); never writes there.
 * - An unknown collection id rejects.
 */

// defaultScan and isReadableDirectory live in service.js (rescan.js already
// imports it, so sharing from there adds no circular import).
const { createCollectionService, defaultScan, isReadableDirectory } = require('./service.js');

const RESCAN_IN_PROGRESS = 'RESCAN_IN_PROGRESS';

function createRescanService({ storage, scan = defaultScan } = {}) {
  if (!storage) throw new Error('storage is required');
  const views = createCollectionService({ storage, scan });
  const inFlight = new Set();

  function markUnavailable(folder) {
    if (!folder.unavailable) storage.setFolderUnavailable(folder.id, true);
  }

  // Returns true when the folder was rescanned, false when it was skipped.
  async function rescanFolder(folder) {
    if (!(await isReadableDirectory(folder.path))) {
      markUnavailable(folder);
      return false;
    }
    let records;
    try {
      records = await scan(folder.path);
    } catch {
      markUnavailable(folder);
      return false;
    }
    // Re-read after the await: the snapshot in `folder` may be stale if another
    // operation changed the record while the scan ran. If the folder was removed
    // from storage meanwhile, write nothing and report it skipped.
    const current = storage.getFolder(folder.id);
    if (!current) return false;
    storage.replaceFolderIndex(folder.id, records);
    if (current.unavailable) storage.setFolderUnavailable(folder.id, false);
    return true;
  }

  async function rescanCollection(collectionId) {
    const collection = storage.getCollection(collectionId);
    if (!collection) throw new Error(`unknown collection: ${collectionId}`);
    if (inFlight.has(collectionId)) {
      const err = new Error('A rescan of this collection is already in progress');
      err.code = RESCAN_IN_PROGRESS;
      throw err;
    }
    inFlight.add(collectionId);
    try {
      const summary = { rescanned: [], skipped: [] };
      for (const folder of storage.listFolders(collectionId)) {
        const done = await rescanFolder(folder);
        (done ? summary.rescanned : summary.skipped).push(folder.id);
      }
      return { ...views.getCollectionView(collectionId), summary };
    } finally {
      inFlight.delete(collectionId);
    }
  }

  return { rescanCollection };
}

module.exports = { createRescanService, RESCAN_IN_PROGRESS };
