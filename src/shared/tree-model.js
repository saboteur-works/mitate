'use strict';

// pathCompare: require under Node/Vitest, global in the renderer (loaded by a
// script tag before this file).
const pathCompare =
  typeof module !== 'undefined' && module.exports ? require('./path-compare.js') : globalThis.PathCompare;

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
 *     id: string,              // node identity, unique per root (see "Node identity")
 *     folderId: string         // id of the root folder record this node belongs to
 *   }
 *
 * Node identity: `path` is NOT an identity, because roots may overlap (roots
 * /a and /a/b are both kept), so the root /a/b and the subfolder b under root
 * /a have the same absolute path. Every node therefore has an `id` built as
 * `<rootFolderId>:<relativePath>` (the root's folder record id, a colon, and
 * the node's relativePath; a root has relativePath '' so its id is
 * `<rootFolderId>:`). Ids are distinct across the whole tree. Expansion state,
 * row keys and lookups must use `id`; `path` is for display only.
 *
 * Root folders (user decision, overrides the literal FR-11 wording): every
 * top-level (added) folder of the collection is ALWAYS in the tree, whether or
 * not it has stored files and whether or not it is available. A root with no
 * files appears with children: []; an unavailable root appears flagged
 * unavailable (its stored files, if any, are shown flagged unavailable). The
 * prune-empty rule applies only below the roots: a subfolder node exists only
 * because some file's relativePath passes through it, so every non-root folder
 * contains at least one supported file at any depth and empty subfolders are
 * absent.
 *
 * Order: at each level subfolders come before files; each group is sorted by
 * name with a case-insensitive natural numeric order (IMG_2 before IMG_10).
 * Comparison uses Intl.Collator('en', numeric, base sensitivity), available in
 * both Node and browsers. Ties (names equal ignoring case, e.g. a.jpg and
 * A.jpg, or f2 and f02) are broken
 * deterministically by comparing the raw names by UTF-16 code unit, then paths.
 * Root nodes are ordered by the same comparison.
 *
 * De-duplication (FR-9, FR-13): within one collection a file is shown once. A
 * root has "owners": every root whose path strictly contains it, and every
 * root with the identical path that comes EARLIER in the folderRecords order
 * (the input order is the tie-break). Paths compared are `resolvedPath ||
 * path` using PathCompare (whole segments, case-insensitive). A root drops a
 * file only when an owner has a file record whose absolute path (owner path +
 * relativePath) is the same. If no owner has a record (stale owner index) the
 * inner root keeps the file. Roots themselves are never dropped, so an inner
 * root may end up with children: []. An unavailable owner still owns. Cost:
 * one Set of normalised file paths per owning root; each file is one lookup
 * per owner of its root.
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

function nodeId(folderId, relativePath) {
  return folderId + ':' + relativePath;
}

function makeFolder(folderId, name, path, relativePath, unavailable) {
  return {
    type: 'folder',
    id: nodeId(folderId, relativePath),
    folderId,
    name,
    path,
    relativePath,
    unavailable,
    children: [],
  };
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
      dir = makeFolder(root.folderId, parts[i], root.path + '/' + relSoFar, relSoFar, root.unavailable);
      byRel.set(relSoFar, dir);
      parent.children.push(dir);
    }
    parent = dir;
  }
  const fileRel = parts.join('/');
  parent.children.push({
    type: 'file',
    id: nodeId(root.folderId, fileRel),
    folderId: root.folderId,
    name: rec.name !== undefined ? rec.name : parts[parts.length - 1],
    path: rec.path,
    relativePath: fileRel,
    unavailable: root.unavailable || rec.unavailable === true,
    kind: rec.kind,
  });
  return true;
}

function effectivePath(f) {
  return f.resolvedPath || f.path;
}

// Case-folded absolute key of a file under a root, or null for an unusable path.
function fileKey(rootPath, rec) {
  const rel = String(rec.relativePath || rec.name || '');
  const abs = pathCompare.normalize(String(rootPath) + '/' + rel);
  return abs === null ? null : abs.toLowerCase();
}

// Indexes (into the entries array) of the roots that own entries[i].
function ownersOf(entries, i) {
  const owners = [];
  for (let j = 0; j < entries.length; j++) {
    if (j === i) continue;
    const a = entries[j].effPath;
    const b = entries[i].effPath;
    if (pathCompare.contains(a, b) || (j < i && pathCompare.isSame(a, b))) owners.push(j);
  }
  return owners;
}

function buildTree(folderRecords, fileRecords) {
  const entries = [];
  const byId = new Map();
  for (const f of folderRecords || []) {
    if (byId.has(f.id)) continue;
    const root = makeFolder(f.id, baseName(f.path), f.path, '', f.unavailable === true);
    const entry = { root, byRel: new Map(), effPath: effectivePath(f), files: [], owners: [], keys: null };
    byId.set(f.id, entry);
    entries.push(entry);
  }
  for (const rec of fileRecords || []) {
    const entry = byId.get(rec.folderId);
    if (entry) entry.files.push(rec);
  }
  entries.forEach((e, i) => {
    e.owners = ownersOf(entries, i);
  });
  // Key sets are built only for roots that own another root.
  for (const e of entries) {
    for (const j of e.owners) {
      const owner = entries[j];
      if (owner.keys === null) {
        owner.keys = new Set();
        for (const rec of owner.files) {
          const k = fileKey(owner.effPath, rec);
          if (k !== null) owner.keys.add(k);
        }
      }
    }
  }
  const result = [];
  for (const e of entries) {
    for (const rec of e.files) {
      if (e.owners.length > 0) {
        const k = fileKey(e.effPath, rec);
        if (k !== null && e.owners.some((j) => entries[j].keys.has(k))) continue;
      }
      addFile(e.root, rec, e.byRel);
    }
    sortChildren(e.root);
    result.push(e.root);
  }
  result.sort(compareNodes);
  return result;
}

// Ordered visible rows. `tree` is the root-node array from buildTree;
// `expandedSet` is a Set of folder node ids that are expanded. Children of a
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
    if (node.type === 'folder' && expanded.has(node.id)) {
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
