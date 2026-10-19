'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { openStorage } = require('./storage/index.js');
const { startStorage } = require('./startup.js');
const { createCollectionService, defaultScan } = require('./collections/service.js');
const { createRescanService } = require('./collections/rescan.js');
const { registerIpc } = require('./ipc.js');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

// Test-only hook: MEDIA_ORGANIZER_RESCAN_DELAY_MS delays each rescan scan call so
// e2e tests can observe the in-flight state. Unset in normal use (no effect).
function rescanScan() {
  const delay = Number(process.env.MEDIA_ORGANIZER_RESCAN_DELAY_MS);
  if (!(delay > 0)) return defaultScan;
  return async (folderPath) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return defaultScan(folderPath);
  };
}

app.whenReady().then(async () => {
  const started = await startStorage({
    baseDir: app.getPath('userData'),
    openStorage,
    reportError: (message) => dialog.showErrorBox('Cannot open data file', message),
  });
  if (!started.ok) {
    app.quit();
    return;
  }
  const storage = started.storage;
  const service = createCollectionService({ storage });
  const rescanService = createRescanService({ storage, scan: rescanScan() });
  registerIpc({ ipcMain, dialog, service, rescanService, getWindow: () => BrowserWindow.getFocusedWindow() });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
