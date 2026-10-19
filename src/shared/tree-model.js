'use strict';

/*
 * Tree model (FR-11, structure and order).
 *
 * Pure functions that turn storage records into the folder tree of a
 * collection. No Node-only imports (no fs, no path), so the same file loads in
 * the Electron main process and in the renderer.
 *
 * Loading:
 *   main / Vitest (CommonJS):  const TreeModel = require('../shared/tree-model.js');
 *   renderer (script tag):     <script src="../shared/tree-model.js"></script>
 *                              then use the global `TreeModel`
 *                              (globalThis.TreeModel.buildTree, ...).
 *   In the renderer `module` is undefined, so only the global is set.
 *
 * Input (shapes defined in src/main/storage/index.js):
 *   FolderRecord { id, collectionId, path, unavailable }
 *   FileRecord   { folderId, collectionId, path, relativePath ("/" separated),
 *                  name, extension, kind, unavailable?, ... }
 *   File records are matched to folders by folderId. A file whose folderId has
 *   no folder record in the input is ignored. Every file record in the index
 *   is a supported file (the scanner only stores supported files), so "folders
 *   with at least one supported file at any depth" follows from building
 *   folder nodes only from file relativePaths.
 *
 * Node shape:
 *   {
 *     type: 'folder' | 'file',
 *     name: string,            // folder: basename of the path; file: record name
 *     path: string,            // absolute path (subfolders: root path + "/" + relativePath)
 *     relativePath: string,    // within its root folder, "/" separated; '' for a root
 *     unavailable: boolean,    // folder: from the folder record (roots) or its root
 *                              // (subfolders); file: true when its folder is unavailable
 *     children?: Node[],       // folders only: subfolders first, then files
 *     kind?: string,           // files only: copied from the file record
 *     id?: string              // roots only: the folder record id
 *   }
 *
 * Empty root folders (decision): FR-11 says the tree shows only folders that
 * contain at least one supported file at any depth, and states no exception
 * for added (root) folders. buildTree follows it literally: a root folder with
 * no stored files is omitted, whether or not it is unavailable. An unavailable
 * root folder that still has stored files IS shown, flagged unavailable, with
 * all its files flagged unavailable.
 *
 * Order: at each level subfolders come before files; each group is sorted by
 * name with a case-insensitive natural numeric order (IMG_2 before IMG_10).
 * Comparison uses Intl.Collator('en', numeric, base sensitivity), available in
 * both Node and browsers. Ties (names equal ignoring case, e.g. a.jpg and
 * A.jpg, or f2 and f02) are broken
 * deterministically by comparing the raw names by UTF-16 code unit, then paths.
 * Root nodes are ordered by the same comparison.
 *
 * Exports: buildTree(folderRecords, fileRecords) -> Node[] (root nodes),
 * flattenVisible(tree, expandedSet) -> { node, depth }[], compareNames(a, b).
 */

// Fixed locale so the order does not depend on the user's locale; numeric
// compares digit runs by value; base sensitivity ignores case and accents.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function compareRaw(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Case-insensitive natural numeric comparison with a deterministic tiebreak.
function compareNames(a, b) {
  const sa = String(a);
  const sb = String(b);
  return collator.compare(sa, sb) || compareRaw(sa, sb);
}

function compareNodes(a, b) {
  return compareNames(a.name, b.name) || compareRaw(a.path, b.path);
}

function baseName(p) {
  const trimmed = String(p).replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

function makeFolder(name, path, relativePath, unavailable) {
  return { type: 'folder', name, path, relativePath, unavailable, children: [] };
}

function sortChildren(folder) {
  const folders = folder.children.filter((c) => c.type === 'folder');
  const files = folder.children.filter((c) => c.type === 'file');
  folders.sort(compareNodes);
  files.sort(compareNodes);
  folder.children = folders.concat(files);
  folders.forEach(sortChildren);
}

function addFile(root, rec, byRel) {
  const rel = String(rec.relativePath || rec.name || '');
  const parts = rel.split('/').filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  let parent = root;
  let relSoFar = '';
  for (let i = 0; i < parts.length - 1; i++) {
    relSoFar = relSoFar ? relSoFar + '/' + parts[i] : parts[i];
    let dir = byRel.get(relSoFar);
    if (!dir) {
      dir = makeFolder(parts[i], root.path + '/' + relSoFar, relSoFar, root.unavailable);
      byRel.set(relSoFar, dir);
      parent.children.push(dir);
    }
    parent = dir;
  }
  parent.children.push({
    type: 'file',
    name: rec.name !== undefined ? rec.name : parts[parts.length - 1],
    path: rec.path,
    relativePath: parts.join('/'),
    unavailable: root.unavailable || rec.unavailable === true,
    kind: rec.kind,
  });
  return true;
}

function buildTree(folderRecords, fileRecords) {
  const roots = new Map();
  for (const f of folderRecords || []) {
    const root = makeFolder(baseName(f.path), f.path, '', f.unavailable === true);
    root.id = f.id;
    roots.set(f.id, { root, byRel: new Map(), count: 0 });
  }
  for (const rec of fileRecords || []) {
    const entry = roots.get(rec.folderId);
    if (entry && addFile(entry.root, rec, entry.byRel)) entry.count++;
  }
  const result = [];
  for (const { root, count } of roots.values()) {
    if (count === 0) continue;
    sortChildren(root);
    result.push(root);
  }
  result.sort(compareNodes);
  return result;
}

// Ordered visible rows. `tree` is the root-node array from buildTree;
// `expandedSet` is a Set of folder node paths that are expanded. Children of a
// folder are included only when the folder is expanded; collapsed folders and
// their descendants are not visited, so cost follows what is visible.
function flattenVisible(tree, expandedSet) {
  const expanded = expandedSet || new Set();
  const rows = [];
  const stack = [];
  for (let i = tree.length - 1; i >= 0; i--) stack.push({ node: tree[i], depth: 0 });
  while (stack.length > 0) {
    const row = stack.pop();
    rows.push(row);
    const { node, depth } = row;
    if (node.type === 'folder' && expanded.has(node.path)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push({ node: node.children[i], depth: depth + 1 });
      }
    }
  }
  return rows;
}

const TreeModel = { buildTree, flattenVisible, compareNames };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TreeModel;
} else {
  globalThis.TreeModel = TreeModel;
}
