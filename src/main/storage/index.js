'use strict';

/*
 * Storage module (FR-2, FR-3, FR-13, FR-18).
 *
 * The single owner of persisted app data: collection records, folder records,
 * the file index and folder-access data. Nothing else reads or writes the
 * store file; callers use only the API below. Values returned are deep copies,
 * so callers cannot mutate stored state except through the API. The on-disk
 * format is private to this module (JSON today; encryption or a SQLite swap
 * must stay inside this file).
 *
 * Location (FR-18): configured in ONE place, the `location` entry of the
 * config passed to openStorage(config). It is either `{ file }` (an absolute
 * file path) or `{ baseDir }` (an absolute directory; the store file is
 * <baseDir>/store.json). With no location the default is
 * <app-data dir>/media-organizer/store.json (see defaultStorageFile), the
 * per-user app-data directory, not a collection folder (FR-13). The module
 * does not use Electron; main may pass app.getPath('userData') as
 * `location.baseDir`.
 *
 * Records:
 *   CollectionRecord {
 *     id: string, name: string, folderIds: string[], createdAt: string (ISO)
 *   }
 *   FolderRecord {
 *     id: string, collectionId: string,
 *     path: string            // absolute path of the folder
 *     unavailable: boolean    // true when the folder could not be read (FR-4)
 *   }
 *   FileRecord {              // one entry of the file index
 *     folderId: string, collectionId: string,   // set by replaceFolderIndex
 *     path: string            // absolute path of the file
 *     relativePath: string    // path within the folder, "/" separated
 *     name: string            // base name including extension
 *     extension: string       // lower-case, no dot ("" if none)
 *     kind: string            // file kind, e.g. "image", "video", "other"
 *     unavailable?: boolean   // set when the owning folder is unavailable
 *     ...any further fields the indexer adds are stored unchanged
 *   }
 *   FolderAccess              // per-folder access data (FR-3); an opaque
 *                             // object, e.g. a future security-scoped bookmark
 *
 * API (returned by openStorage): getLocation, listCollections, getCollection,
 * putCollection, removeCollection (cascades to folders, index, access),
 * listFolders(collectionId?), getFolder, putFolder, setFolderUnavailable,
 * removeFolder (cascades), getIndex({collectionId?, folderId?}),
 * replaceFolderIndex(folderId, fileRecords), getFolderAccess, setFolderAccess.
 *
 * Known risk: a JSON store rewritten on each write is not expected to scale to
 * hundreds of thousands of files (unmeasured).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STORE_FILE_NAME = 'store.json';
const APP_DIR_NAME = 'media-organizer';
const FORMAT_VERSION = 1;

function appDataDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (process.platform === 'win32') return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
}

function defaultStorageFile() {
  return path.join(appDataDir(), APP_DIR_NAME, STORE_FILE_NAME);
}

function resolveStorageFile(config) {
  const location = (config && config.location) || {};
  if (location.file !== undefined) {
    if (typeof location.file !== 'string' || !path.isAbsolute(location.file)) {
      throw new Error('storage location.file must be an absolute path');
    }
    return location.file;
  }
  if (location.baseDir !== undefined) {
    if (typeof location.baseDir !== 'string' || !path.isAbsolute(location.baseDir)) {
      throw new Error('storage location.baseDir must be an absolute path');
    }
    return path.join(location.baseDir, STORE_FILE_NAME);
  }
  return defaultStorageFile();
}

function emptyState() {
  return { version: FORMAT_VERSION, collections: {}, folders: {}, index: {}, access: {} };
}

function load(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState();
    throw err;
  }
  const state = JSON.parse(text);
  if (!state || state.version !== FORMAT_VERSION) {
    throw new Error(`unsupported storage format in ${file}`);
  }
  return Object.assign(emptyState(), state);
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function requireString(value, label) {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} must be a non-empty string`);
}

function openStorage(config) {
  const file = resolveStorageFile(config);
  const state = load(file);
  const commit = () => save(file, state);

  function requireFolder(folderId) {
    const folder = state.folders[folderId];
    if (!folder) throw new Error(`unknown folder: ${folderId}`);
    return folder;
  }

  function dropFolder(folderId) {
    delete state.folders[folderId];
    delete state.index[folderId];
    delete state.access[folderId];
  }

  return {
    getLocation: () => file,

    listCollections: () => copy(Object.values(state.collections)),
    getCollection: (id) => copy(state.collections[id]),
    putCollection(record) {
      requireString(record && record.id, 'collection id');
      requireString(record.name, 'collection name');
      state.collections[record.id] = copy(record);
      commit();
    },
    removeCollection(id) {
      for (const folder of Object.values(state.folders)) {
        if (folder.collectionId === id) dropFolder(folder.id);
      }
      delete state.collections[id];
      commit();
    },

    listFolders(collectionId) {
      const all = Object.values(state.folders);
      return copy(collectionId === undefined ? all : all.filter((f) => f.collectionId === collectionId));
    },
    getFolder: (id) => copy(state.folders[id]),
    putFolder(record) {
      requireString(record && record.id, 'folder id');
      requireString(record.collectionId, 'folder collectionId');
      if (typeof record.path !== 'string' || !path.isAbsolute(record.path)) {
        throw new Error('folder path must be an absolute path');
      }
      state.folders[record.id] = copy(Object.assign({ unavailable: false }, record));
      commit();
    },
    setFolderUnavailable(id, unavailable) {
      requireFolder(id).unavailable = Boolean(unavailable);
      commit();
    },
    removeFolder(id) {
      dropFolder(id);
      commit();
    },

    getIndex(filter) {
      const { collectionId, folderId } = filter || {};
      const ids = folderId !== undefined ? [folderId] : Object.keys(state.index);
      const files = ids.flatMap((id) => state.index[id] || []);
      return copy(collectionId === undefined ? files : files.filter((f) => f.collectionId === collectionId));
    },
    replaceFolderIndex(folderId, fileRecords) {
      const folder = requireFolder(folderId);
      if (!Array.isArray(fileRecords)) throw new Error('file records must be an array');
      state.index[folderId] = copy(
        fileRecords.map((r) => Object.assign({}, r, { folderId, collectionId: folder.collectionId }))
      );
      commit();
    },

    getFolderAccess: (folderId) => copy(state.access[folderId]),
    setFolderAccess(folderId, data) {
      requireFolder(folderId);
      state.access[folderId] = copy(data);
      commit();
    },
  };
}

module.exports = { openStorage, defaultStorageFile };
