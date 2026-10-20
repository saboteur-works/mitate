'use strict';

/*
 * Virtualized folder tree view (FR-11 render, FR-4 display).
 *
 * Renders the tree from TreeModel.buildTree (global, loaded from
 * ../shared/tree-model.js) into the element [data-testid="tree-view"]. Only the
 * rows inside the scroll viewport plus a small buffer are in the DOM; a spacer
 * element of height (row count * ROW_HEIGHT) gives the scrollbar its full
 * range and each rendered row is absolutely positioned inside it. The DOM size
 * therefore depends on the viewport height, not on the number of files.
 *
 * Decisions:
 * - Node identity is node.id (unique per root, see tree-model.js): expansion state
 *   and the data-node-id attribute use it. data-path (absolute path) is display only
 *   and can be shared by rows of overlapping roots.
 * - Root folders start COLLAPSED; click a folder row to expand or collapse it.
 *   (Rows are only materialized for visible entries, so expanding a root with
 *   tens of thousands of files is still cheap in the DOM.)
 * - ROW_HEIGHT 24px (must match .tree-row in styles.css), BUFFER 5 rows above
 *   and below the viewport.
 * - Anything with node.unavailable (unavailable roots, their subfolders and
 *   their files) shows a visible "unavailable" label; nothing is hidden.
 *
 * - Selection: at most one file is selected, held as a node id (selectedId) so it survives
 *   virtualized re-renders; makeRow derives aria-selected / .tree-selected from it. Selecting
 *   or clearing dispatches `file-selected` on document with detail.file = the node (at least
 *   path and nodeId) or null. Clicking a folder never changes the selection.
 *
 * API: window.TreeView.show(folders, files) replaces the displayed collection
 * (folders/files as returned by the collections view); TreeView.update(folders, files)
 * replaces them keeping the expanded folders.
 */
(function () {
  const ROW_HEIGHT = 24;
  const BUFFER = 5;
  const INDENT = 16;

  const container = document.querySelector('[data-testid="tree-view"]');
  const spacer = document.createElement('div');
  spacer.className = 'tree-spacer';
  spacer.dataset.testid = 'tree-spacer';
  container.appendChild(spacer);

  let rows = [];
  let expanded = new Set();
  let tree = [];
  let selectedId = null;
  let firstRendered = -1;
  let lastRendered = -1;

  function makeRow(entry, index) {
    const { node, depth } = entry;
    const isFolder = node.type === 'folder';
    const row = document.createElement('div');
    row.className = 'tree-row ' + (isFolder ? 'tree-folder' : 'tree-file');
    row.dataset.testid = 'tree-row';
    row.dataset.type = node.type;
    row.dataset.index = String(index);
    row.dataset.nodeId = node.id;
    row.dataset.path = node.path;
    row.setAttribute('role', 'treeitem');
    row.style.top = index * ROW_HEIGHT + 'px';
    row.style.paddingLeft = depth * INDENT + 4 + 'px';
    if (isFolder) {
      const open = expanded.has(node.id);
      row.dataset.expanded = String(open);
      row.setAttribute('aria-expanded', String(open));
      row.addEventListener('click', () => toggle(node.id));
    } else {
      const selected = node.id === selectedId;
      row.setAttribute('aria-selected', String(selected));
      row.classList.toggle('tree-selected', selected);
      row.addEventListener('click', () => selectFile(node));
    }
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.dataset.testid = 'tree-name';
    name.textContent = (isFolder ? (expanded.has(node.id) ? '▾ ' : '▸ ') : '') + node.name;
    row.appendChild(name);
    if (node.unavailable) {
      const label = document.createElement('span');
      label.className = 'tree-unavailable';
      label.dataset.testid = 'unavailable';
      label.textContent = 'unavailable';
      row.appendChild(label);
    }
    return row;
  }

  function renderWindow() {
    const top = container.scrollTop;
    const height = container.clientHeight;
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - BUFFER);
    const last = Math.min(rows.length - 1, Math.ceil((top + height) / ROW_HEIGHT) + BUFFER);
    if (first === firstRendered && last === lastRendered) return;
    firstRendered = first;
    lastRendered = last;
    const nodes = [];
    for (let i = first; i <= last; i++) nodes.push(makeRow(rows[i], i));
    spacer.replaceChildren(...nodes);
  }

  function relayout() {
    rows = TreeModel.flattenVisible(tree, expanded);
    spacer.style.height = rows.length * ROW_HEIGHT + 'px';
    firstRendered = -1;
    lastRendered = -1;
    renderWindow();
  }

  function toggle(id) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    relayout();
  }

  function announceSelection(file) {
    document.dispatchEvent(new CustomEvent('file-selected', { detail: { file } }));
  }

  function selectFile(node) {
    if (node.id === selectedId) return;
    selectedId = node.id;
    firstRendered = -1;
    lastRendered = -1;
    renderWindow();
    announceSelection({
      nodeId: node.id,
      path: node.path,
      name: node.name,
      folderId: node.folderId,
      relativePath: node.relativePath,
      kind: node.kind,
      unavailable: node.unavailable === true,
    });
  }

  // Clears the selection and announces it; does nothing when nothing is selected.
  function clearSelection() {
    if (selectedId === null) return;
    selectedId = null;
    announceSelection(null);
  }

  function show(folders, files) {
    tree = TreeModel.buildTree(folders, files);
    expanded = new Set();
    container.scrollTop = 0;
    relayout();
  }

  // Replaces the data but keeps the expanded folders and scroll position (used after a rescan).
  function update(folders, files) {
    tree = TreeModel.buildTree(folders, files);
    relayout();
  }

  container.addEventListener('scroll', renderWindow);
  container.setAttribute('role', 'tree');

  window.TreeView = { show, update };
})();
