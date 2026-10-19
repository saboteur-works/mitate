'use strict';

/*
 * IPC handlers (FR-1 interface). Registered through registerIpc so they can be
 * tested with fake ipcMain/dialog objects.
 *
 *   folders:pick        -> { canceled, paths }   native folder picker; directories
 *                          only (openDirectory + multiSelections, never openFile)
 *   collections:create  (name, directories) -> { ok: true, view } | { ok: false, error }
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
 *                          { ok: false, error, busy: true } (error code
 *                          RESCAN_IN_PROGRESS from the rescan service).
 *
 * getRegisteredHandler(channel) -> the handler function registerIpc registered for
 *                          that channel, or undefined. The module keeps a registry of
 *                          the original handlers (last registerIpc call wins); it is
 *                          not changed when a channel is later re-registered with
 *                          ipcMain.removeHandler/handle, so the original stays
 *                          reachable for wrapping or delegation. Handlers have the
 *                          signature (event, ...args).
 *
 * Service errors are returned as { ok: false, error } so the renderer can show
 * the message without Electron's "Error invoking remote method" prefix.
 */

const { RESCAN_IN_PROGRESS } = require('./collections/rescan.js');

const CHANNELS = {
  pickFolders: 'folders:pick',
  createCollection: 'collections:create',
  listCollections: 'collections:list',
  getCollectionView: 'collections:getView',
  rescanCollection: 'collections:rescan',
};

const registered = new Map();

function getRegisteredHandler(channel) {
  return registered.get(channel);
}

const PICKER_PROPERTIES = ['openDirectory', 'multiSelections'];

function registerIpc({ ipcMain, dialog, service, rescanService = null, getWindow = () => null }) {
  registered.clear();
  function handle(channel, fn) {
    registered.set(channel, fn);
    ipcMain.handle(channel, fn);
  }

  async function guard(fn) {
    try {
      return { ok: true, ...(await fn()) };
    } catch (err) {
      const failure = { ok: false, error: err && err.message ? err.message : String(err) };
      if (err && err.code === RESCAN_IN_PROGRESS) failure.busy = true;
      return failure;
    }
  }

  handle(CHANNELS.pickFolders, async () => {
    const options = { title: 'Add folder', properties: [...PICKER_PROPERTIES] };
    const win = getWindow();
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: [...result.filePaths] };
  });

  handle(CHANNELS.createCollection, (_event, name, directories) =>
    guard(async () => ({ view: await service.createCollection(name, directories) })));

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
}

module.exports = { registerIpc, getRegisteredHandler, CHANNELS, PICKER_PROPERTIES };
