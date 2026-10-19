'use strict';

/*
 * Rescan service (FR-20, FR-4, FR-13). Main-process logic with no Electron
 * imports; storage and the scan function are injected.
 *
 *   createRescanService({ storage, scan = runScan })
 *     rescanCollection(collectionId)
 *       -> Promise<{collection, folders, files, summary: {rescanned, skipped}}>
 *
 * Decisions:
 * - The view part has the same shape as collectionService.getCollectionView
 *   (it is produced by that function; file-level `unavailable` is derived from
 *   the folder flag).
 * - A folder that is not an accessible directory is skipped: its stored files
 *   and record are untouched except that the folder is flagged unavailable.
 * - An available folder is scanned and its index replaced; a folder that was
 *   flagged unavailable is marked available again only after the new index is
 *   stored. If the scan rejects, the folder is flagged unavailable, its stored
 *   files are kept, and it is reported in `skipped`.
 * - Launch behaviour ("show the stored index without scanning") is
 *   loadCollections in service.js; nothing here runs on launch.
 * - Only reads collection folders (stat, access, scan); never writes there.
 * - An unknown collection id rejects.
 */

// defaultScan and isReadableDirectory live in service.js (rescan.js already
// imports it, so sharing from there adds no circular import).
const { createCollectionService, defaultScan, isReadableDirectory } = require('./service.js');

function createRescanService({ storage, scan = defaultScan } = {}) {
  if (!storage) throw new Error('storage is required');
  const views = createCollectionService({ storage, scan });

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
    storage.replaceFolderIndex(folder.id, records);
    if (folder.unavailable) storage.setFolderUnavailable(folder.id, false);
    return true;
  }

  async function rescanCollection(collectionId) {
    const collection = storage.getCollection(collectionId);
    if (!collection) throw new Error(`unknown collection: ${collectionId}`);
    const summary = { rescanned: [], skipped: [] };
    for (const folder of storage.listFolders(collectionId)) {
      const done = await rescanFolder(folder);
      (done ? summary.rescanned : summary.skipped).push(folder.id);
    }
    return { ...views.getCollectionView(collectionId), summary };
  }

  return { rescanCollection };
}

module.exports = { createRescanService };
