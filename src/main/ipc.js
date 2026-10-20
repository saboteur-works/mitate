'use strict';

/*
 * IPC handlers (FR-1 interface). Registered through registerIpc so they can be
 * tested with fake ipcMain/dialog objects.
 *
 *   folders:pick        -> { canceled, paths }   native folder picker; directories
 *                          only (openDirectory + multiSelections, never openFile)
 *   collections:create  (name, directories) -> { ok: true, summary: { id, name, folderCount } }
 *                          | { ok: false, error }; the tree is loaded by collections:getView
 *   collections:list    -> { ok: true, summaries } | { ok: false, error }
 *                          summaries = [{ id, name, folderCount,
 *                          folders: [{ id, path, unavailable }] }]; no file records
 *   collections:getView (collectionId) -> { ok: true, view } | { ok: false, error }
 *                          view = { collection, folders, files }; file records of
 *                          unavailable folders carry unavailable: true. Reads the
 *                          stored index; availability is refreshed by collections:list.
 *   collections:rescan  (collectionId) -> { ok: true, view, summary } | { ok: false, error }
 *                          user-triggered rescan (FR-20); needs rescanService, else
 *                          { ok: false, error }. Never invoked on launch.
 *                          A rescan already running for the same collection gives
 *                          { ok: false, error, code: 'RESCAN_IN_PROGRESS' }.
 *   files:reveal        (filePath) -> { ok: true } | { ok: false, error, code? }
 *                          reveals exactly that path in the OS file manager. A path
 *                          that is not a non-empty string, or that service.findIndexedFile
 *                          does not return, gives code 'NOT_INDEXED' before any file-system
 *                          access; a missing file gives code 'FILE_NOT_FOUND' (thrown by
 *                          revealFile); no revealFile injected gives { ok: false, error }.
 *
 * Service errors are returned as { ok: false, error } (plus code when the error
 * has one) so the renderer can show the message without Electron's "Error
 * invoking remote method" prefix.
 */

const { messageOf } = require('./message-of.js');

const CHANNELS = {
  pickFolders: 'folders:pick',
  createCollection: 'collections:create',
  listCollections: 'collections:list',
  getCollectionView: 'collections:getView',
  rescanCollection: 'collections:rescan',
  revealFile: 'files:reveal',
};

const PICKER_PROPERTIES = ['openDirectory', 'multiSelections'];

function registerIpc({ ipcMain, dialog, service, rescanService = null, revealFile = null, getWindow = () => null }) {
  const handle = (channel, fn) => ipcMain.handle(channel, fn);

  async function guard(fn) {
    try {
      return { ok: true, ...(await fn()) };
    } catch (err) {
      const failure = { ok: false, error: messageOf(err) };
      if (err && err.code) failure.code = err.code;
      return failure;
    }
  }

  handle(CHANNELS.pickFolders, async () => {
    const options = { title: 'Add folder', properties: PICKER_PROPERTIES };
    const win = getWindow();
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: [...result.filePaths] };
  });

  handle(CHANNELS.createCollection, (_event, name, directories) =>
    guard(async () => {
      const { collection, folders } = await service.createCollection(name, directories);
      return { summary: { id: collection.id, name: collection.name, folderCount: folders.length } };
    }));

  handle(CHANNELS.listCollections, () =>
    guard(async () => ({ summaries: await service.listCollectionSummaries() })));

  handle(CHANNELS.getCollectionView, (_event, collectionId) =>
    guard(async () => {
      const view = service.getCollectionView(collectionId);
      if (!view) throw new Error(`Unknown collection: ${String(collectionId)}`);
      return { view };
    }));

  handle(CHANNELS.rescanCollection, (_event, collectionId) =>
    guard(async () => {
      if (!rescanService) throw new Error('Rescan is not available');
      const { summary, ...view } = await rescanService.rescanCollection(collectionId);
      return { view, summary };
    }));

  // The index check runs first so an unindexed path never reaches the file system.
  handle(CHANNELS.revealFile, (_event, filePath) =>
    guard(async () => {
      if (typeof filePath !== 'string' || filePath === '' || !service.findIndexedFile(filePath)) {
        const err = new Error('File is not in the index');
        err.code = 'NOT_INDEXED';
        throw err;
      }
      if (!revealFile) throw new Error('Reveal is not available');
      await revealFile(filePath);
      return {};
    }));
}

module.exports = { registerIpc, CHANNELS };
