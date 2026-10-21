'use strict';

// Type list model (Feature 4, FR-1, FR-2, FR-4, FR-8).
//
// Pure function that turns storage records into the flat list of one media
// kind for a collection: one row per file, de-duplicated by the same
// one-appearance rule the tree uses (TreeModel.ownedFiles), sorted for display.
// No DOM, no Node-only imports, so it loads in the renderer and under Vitest.
//
// Loading:
//   Node/Vitest (CommonJS):  const TypeList = require('../shared/type-list.js');
//   renderer (script tag):   <script src="../shared/type-list.js"></script> after
//                            tree-model.js, then use the global `TypeList`.
//
// Row shape:
//   { nodeId, path, name, folderId, relativePath, kind, unavailable, folder }
//   nodeId  `<rootFolderId>:<relativePath>`, the id the tree gives the same file
//   folder  the file's directory relative to its root ("Photos/2024"), or the
//           root folder's name for a top-level file
//   unavailable  true when the file's folder is unavailable or the record says so
//
// Order: TreeModel.compareNames on the name, ties by absolute path (UTF-16 code
// unit order), so the same data gives the same order on every call.
//
// Exports: buildTypeList(folderRecords, fileRecords, kind) -> Row[], KINDS.
//
// The body is wrapped so a classic <script> load leaks only `TypeList`.
(function () {
  const treeModel =
    typeof module !== 'undefined' && module.exports ? require('./tree-model.js') : globalThis.TreeModel;

  const KINDS = ['image', 'audio', 'video', 'document'];

  function baseName(p) {
    const trimmed = String(p).replace(/[\\/]+$/, '');
    const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
    return i >= 0 ? trimmed.slice(i + 1) : trimmed;
  }

  function compareRows(a, b) {
    return treeModel.compareNames(a.name, b.name) || (a.path === b.path ? 0 : a.path < b.path ? -1 : 1);
  }

  function makeRow(folder, rec) {
    const parts = String(rec.relativePath || rec.name || '')
      .split('/')
      .filter((p) => p.length > 0);
    const relativePath = parts.join('/');
    const dir = parts.slice(0, -1).join('/');
    return {
      nodeId: folder.id + ':' + relativePath,
      path: rec.path,
      name: rec.name !== undefined ? rec.name : parts[parts.length - 1],
      folderId: folder.id,
      relativePath,
      kind: rec.kind,
      unavailable: folder.unavailable === true || rec.unavailable === true,
      folder: dir === '' ? baseName(folder.path) : dir,
    };
  }

  function buildTypeList(folderRecords, fileRecords, kind) {
    if (!KINDS.includes(kind)) throw new Error('Unknown kind: ' + String(kind));
    const owned = treeModel.ownedFiles(folderRecords, fileRecords);
    const rows = [];
    const seen = new Set();
    for (const folder of folderRecords || []) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      for (const rec of owned.get(folder.id)) {
        // A record with no usable relative path is not a tree node either.
        if (rec.kind === kind && String(rec.relativePath || rec.name || '').split('/').some((p) => p.length > 0)) {
          rows.push(makeRow(folder, rec));
        }
      }
    }
    rows.sort(compareRows);
    return rows;
  }

  const TypeList = { buildTypeList, KINDS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TypeList;
  } else {
    globalThis.TypeList = TypeList;
  }
})();
