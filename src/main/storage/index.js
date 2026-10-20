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
 * <app-data dir>/mitate/store.json (see defaultStorageFile), the
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
 *     ...any further fields the indexer adds are stored unchanged
 *   }
 *   FolderAccess              // per-folder access data (FR-3); an opaque
 *                             // object, e.g. a future security-scoped bookmark
 *
 * Transactions (FR-18): transaction(fn) runs fn synchronously (an async fn is
 * rejected and rolled back) with the same mutators applied in memory only, then
 * persists the whole state in exactly ONE write-then-rename (temp file in the
 * store's directory, renamed over the store file; the temp file is removed on
 * failure). If fn made no mutation nothing is written. If fn throws, or the
 * write fails, the in-memory state is restored from a deep snapshot taken
 * before fn, nothing is written and the stored file is untouched. Reads inside
 * fn see the uncommitted changes. Nested transaction calls throw. Mutators
 * called outside a transaction persist immediately, one write each. Returns
 * fn's result.
 *
 * Open failures (openStorage throws): one error type with code
 * 'STORE_OPEN_FAILED' and reason 'unreadable' (the file exists but cannot be
 * read), 'corrupt' (not valid JSON) or 'unsupported-format' (JSON with a
 * format version other than the supported one). The error also carries file,
 * foundVersion and supportedVersion (unsupported-format only) and cause (the
 * original error, for unreadable and corrupt). A bad `location` throws a plain
 * Error. The store file is never changed when opening fails.
 *
 * Test seam: config.fs optionally overrides any of mkdirSync, writeFileSync,
 * renameSync, rmSync, readFileSync (default: node:fs), so tests can count the
 * writes of the store file.
 *
 * API (returned by openStorage): getLocation, transaction, listCollections, getCollection,
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
const APP_DIR_NAME = 'mitate';
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

function openFailed(reason, file, message, extra) {
  const err = new Error(message);
  err.code = 'STORE_OPEN_FAILED';
  err.reason = reason;
  err.file = file;
  err.supportedVersion = FORMAT_VERSION;
  return Object.assign(err, extra);
}

function load(file, fs) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (cause) {
    if (cause.code === 'ENOENT') return emptyState();
    throw openFailed('unreadable', file, `cannot read storage file ${file}: ${cause.message}`, { cause });
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch (cause) {
    throw openFailed('corrupt', file, `storage file ${file} is not valid JSON: ${cause.message}`, { cause });
  }
  if (!state || state.version !== FORMAT_VERSION) {
    throw openFailed('unsupported-format', file, `unsupported storage format in ${file}`, {
      foundVersion: state && Number.isInteger(state.version) ? state.version : undefined,
    });
  }
  return Object.assign(emptyState(), state);
}

function save(file, state, fs) {
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
  // Optional seam (tests): config.fs overrides any of mkdirSync, writeFileSync,
  // renameSync, rmSync, readFileSync; everything else is the real node:fs.
  const fsImpl = Object.assign({}, fs, (config && config.fs) || {});
  let state = load(file, fsImpl);
  let inTransaction = false;
  let dirty = false;
  // Every mutator ends with commit(). Outside a transaction it persists at
  // once; inside one it only marks the in-memory state as changed.
  const commit = () => {
    if (inTransaction) dirty = true;
    else save(file, state, fsImpl);
  };

  function transaction(fn) {
    if (typeof fn !== 'function') throw new Error('transaction requires a function');
    if (inTransaction) throw new Error('nested transactions are not supported');
    const snapshot = copy(state);
    inTransaction = true;
    dirty = false;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        throw new Error('transaction callback must be synchronous');
      }
      if (dirty) {
        inTransaction = false;
        save(file, state, fsImpl);
      }
      return result;
    } catch (err) {
      state = snapshot;
      throw err;
    } finally {
      inTransaction = false;
      dirty = false;
    }
  }

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
    transaction,

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
      // One deep copy; the stored records never alias the caller's objects.
      state.index[folderId] = copy(fileRecords).map((r) =>
        Object.assign(r, { folderId, collectionId: folder.collectionId }));
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

module.exports = { openStorage, defaultStorageFile, resolveStorageFile };
