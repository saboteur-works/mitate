'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { openStorage } = require('./storage/index.js');
const { startStorage } = require('./startup.js');
const { createCollectionService } = require('./collections/service.js');
const { createRescanService } = require('./collections/rescan.js');
const { createInFlightGuard } = require('./collections/in-flight.js');
const { createConfirmer } = require('./confirm.js');
const { createRevealer } = require('./reveal.js');
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

// The app's one window. Dialogs attach to it whether or not it has focus (the
// user may have clicked another app while the folder picker was opening).
let mainWindow = null;

function openMainWindow() {
  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
  // One guard for every per-collection action, so a rescan and a rename,
  // delete, add or remove on the same collection refuse each other.
  const guard = createInFlightGuard();
  const confirm = createConfirmer({ dialog, getWindow: () => mainWindow });
  const service = createCollectionService({ storage, guard, confirm });
  const rescanService = createRescanService({ storage, guard });
  const { revealFile } = createRevealer({ shell });
  registerIpc({ ipcMain, dialog, service, rescanService, revealFile, getWindow: () => mainWindow });
  openMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
