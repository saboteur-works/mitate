'use strict';

// Narrow API exposed to the renderer. The channel names mirror src/main/ipc.js
// (a sandboxed preload cannot require local modules).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaOrganizer', {
  pickFolders: () => ipcRenderer.invoke('folders:pick'),
  createCollection: (name, directories) => ipcRenderer.invoke('collections:create', name, directories),
  listCollections: () => ipcRenderer.invoke('collections:list'),
});
