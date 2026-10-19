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
 * - FR-18: all scans are awaited first; then every index replacement and
 *   flag change of the rescan is applied in one synchronous storage.transaction,
 *   re-reading each folder's state inside it. A rescan that scans at least one
 *   folder writes the store exactly once. A rescan where every folder is
 *   skipped and no flag changes (e.g. already-unavailable folders stay
 *   unavailable) makes no mutation and writes zero times. If applying fails,
 *   nothing is written and the in-memory state is rolled back.
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

  // Awaited phase (no storage writes): decide what to do for one folder.
  // Returns { folder, status: 'scan', records } or { folder, status: 'unavailable' }.
  async function inspectFolder(folder) {
    if (!(await isReadableDirectory(folder.path))) return { folder, status: 'unavailable' };
    try {
      return { folder, status: 'scan', records: await scan(folder.path) };
    } catch {
      return { folder, status: 'unavailable' };
    }
  }

  // Synchronous phase, run inside the transaction. Re-reads the folder from
  // storage (the pre-await snapshot may be stale). Returns true when the folder
  // was rescanned, false when skipped.
  function applyResult({ folder, status, records }) {
    const current = storage.getFolder(folder.id);
    if (!current) return false; // removed from storage while scanning: write nothing
    if (status === 'unavailable') {
      if (!current.unavailable) storage.setFolderUnavailable(folder.id, true);
      return false;
    }
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
      const results = [];
      for (const folder of storage.listFolders(collectionId)) results.push(await inspectFolder(folder));
      storage.transaction(() => {
        for (const result of results) {
          (applyResult(result) ? summary.rescanned : summary.skipped).push(result.folder.id);
        }
      });
      const view = views.getCollectionView(collectionId);
      if (!view) throw new Error(`collection ${collectionId} no longer exists`);
      return { ...view, summary };
    } finally {
      inFlight.delete(collectionId);
    }
  }

  return { rescanCollection };
}

module.exports = { createRescanService, RESCAN_IN_PROGRESS };
