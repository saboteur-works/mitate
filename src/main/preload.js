'use strict';

// Narrow API exposed to the renderer. The channel names mirror src/main/ipc.js
// (a sandboxed preload cannot require local modules).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaOrganizer', {
  pickFolders: () => ipcRenderer.invoke('folders:pick'),
  createCollection: (name, directories) => ipcRenderer.invoke('collections:create', name, directories),
  listCollections: () => ipcRenderer.invoke('collections:list'),
  getCollectionView: (collectionId) => ipcRenderer.invoke('collections:getView', collectionId),
  rescanCollection: (collectionId) => ipcRenderer.invoke('collections:rescan', collectionId),
  renameCollection: (collectionId, name) => ipcRenderer.invoke('collections:rename', collectionId, name),
  deleteCollection: (collectionId) => ipcRenderer.invoke('collections:delete', collectionId),
  addFolder: (collectionId, dirPath) => ipcRenderer.invoke('collections:addFolder', collectionId, dirPath),
  removeFolder: (collectionId, folderId) => ipcRenderer.invoke('collections:removeFolder', collectionId, folderId),
  revealFile: (filePath) => ipcRenderer.invoke('files:reveal', filePath),
});
