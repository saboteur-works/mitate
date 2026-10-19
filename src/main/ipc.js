'use strict';

/*
 * IPC handlers (FR-1 interface). Registered through registerIpc so they can be
 * tested with fake ipcMain/dialog objects.
 *
 *   folders:pick        -> { canceled, paths }   native folder picker; directories
 *                          only (openDirectory + multiSelections, never openFile)
 *   collections:create  (name, directories) -> { ok: true, view } | { ok: false, error }
 *   collections:list    -> { ok: true, views } | { ok: false, error }
 *
 * Service errors are returned as { ok: false, error } so the renderer can show
 * the message without Electron's "Error invoking remote method" prefix.
 */

const CHANNELS = {
  pickFolders: 'folders:pick',
  createCollection: 'collections:create',
  listCollections: 'collections:list',
};

const PICKER_PROPERTIES = ['openDirectory', 'multiSelections'];

function registerIpc({ ipcMain, dialog, service, getWindow = () => null }) {
  async function guard(fn) {
    try {
      return { ok: true, ...(await fn()) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  ipcMain.handle(CHANNELS.pickFolders, async () => {
    const options = { title: 'Add folder', properties: [...PICKER_PROPERTIES] };
    const win = getWindow();
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return { canceled: true, paths: [] };
    return { canceled: false, paths: [...result.filePaths] };
  });

  ipcMain.handle(CHANNELS.createCollection, (_event, name, directories) =>
    guard(async () => ({ view: await service.createCollection(name, directories) })));

  ipcMain.handle(CHANNELS.listCollections, () =>
    guard(async () => ({ views: await service.loadCollections() })));
}

module.exports = { registerIpc, CHANNELS, PICKER_PROPERTIES };
