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
 * - show clears the selection; update keeps it only if the selected node id exists in the rebuilt
 *   tree, else clears it. Clearing dispatches file-selected with detail.file = null.
 *   Both then dispatch `tree-updated` on document (no detail), kept selection or not.
 *
 * - Keyboard (FR-2, FR-11): the container is the single Tab stop (role="tree", tabindex 0). Focus is
 *   a node id (focusedId) resolved against the flattened visible rows; DOM focus stays on the
 *   container and aria-activedescendant points at the focused row's stable id (tree-node-N, N
 *   assigned per node id, because node ids contain characters unsuitable for an id). The focused
 *   row also gets .tree-focused and is always rendered, even when scrolled outside the virtual
 *   window. If focusedId is not among the rows (initially, after show, after update removed it)
 *   focus falls back to the first row. ArrowUp/ArrowDown move without wrapping and scroll the
 *   row into view; Enter/Space select a focused file or toggle a focused folder (a folder toggle
 *   never selects). Clicking a row sets focus to it. No global shortcuts.
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
  let focusedId = null;
  let firstRendered = -1;
  let lastRendered = -1;
  let renderedFocus = -2;
  const domIds = new Map();

  // Stable DOM id for a node id (used by aria-activedescendant).
  function domIdOf(nodeId) {
    let id = domIds.get(nodeId);
    if (id === undefined) {
      id = 'tree-node-' + domIds.size;
      domIds.set(nodeId, id);
    }
    return id;
  }

  // Index in rows of the focused node; falls back to the first row (or -1 when there are none).
  function focusIndex() {
    const i = focusedId === null ? -1 : rows.findIndex((r) => r.node.id === focusedId);
    if (i >= 0) return i;
    focusedId = rows.length > 0 ? rows[0].node.id : null;
    return rows.length > 0 ? 0 : -1;
  }

  function makeRow(entry, index) {
    const { node, depth } = entry;
    const isFolder = node.type === 'folder';
    const row = document.createElement('div');
    row.className = 'tree-row ' + (isFolder ? 'tree-folder' : 'tree-file');
    row.dataset.testid = 'tree-row';
    row.dataset.type = node.type;
    row.dataset.index = String(index);
    row.dataset.nodeId = node.id;
    row.id = domIdOf(node.id);
    row.classList.toggle('tree-focused', node.id === focusedId);
    row.dataset.path = node.path;
    row.setAttribute('role', 'treeitem');
    row.style.top = index * ROW_HEIGHT + 'px';
    row.style.paddingLeft = depth * INDENT + 4 + 'px';
    if (isFolder) {
      const open = expanded.has(node.id);
      row.dataset.expanded = String(open);
      row.setAttribute('aria-expanded', String(open));
      row.addEventListener('click', () => {
        setFocus(node.id);
        toggle(node.id);
      });
    } else {
      const selected = node.id === selectedId;
      row.setAttribute('aria-selected', String(selected));
      row.classList.toggle('tree-selected', selected);
      row.addEventListener('click', () => {
        setFocus(node.id);
        selectFile(node);
      });
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
    const fi = focusIndex();
    if (first === firstRendered && last === lastRendered && fi === renderedFocus) return;
    firstRendered = first;
    lastRendered = last;
    renderedFocus = fi;
    const nodes = [];
    for (let i = first; i <= last; i++) nodes.push(makeRow(rows[i], i));
    // The focused row stays in the DOM (aria-activedescendant target) even outside the window.
    if (fi >= 0 && (fi < first || fi > last)) nodes.push(makeRow(rows[fi], fi));
    spacer.replaceChildren(...nodes);
    if (fi >= 0) container.setAttribute('aria-activedescendant', domIdOf(rows[fi].node.id));
    else container.removeAttribute('aria-activedescendant');
  }

  function setFocus(id) {
    if (id === focusedId) return;
    focusedId = id;
    renderWindow();
  }

  // Scrolls the container just enough to show the row at index.
  function scrollRowIntoView(index) {
    const rowTop = index * ROW_HEIGHT;
    if (rowTop < container.scrollTop) container.scrollTop = rowTop;
    else if (rowTop + ROW_HEIGHT > container.scrollTop + container.clientHeight) {
      container.scrollTop = rowTop + ROW_HEIGHT - container.clientHeight;
    }
  }

  function onKeyDown(event) {
    const fi = focusIndex();
    if (fi < 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, fi + (event.key === 'ArrowDown' ? 1 : -1)));
      focusedId = rows[next].node.id;
      scrollRowIntoView(next);
      renderWindow();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const { node } = rows[fi];
      if (node.type === 'folder') toggle(node.id);
      else selectFile(node);
    }
  }

  function relayout() {
    rows = TreeModel.flattenVisible(tree, expanded);
    spacer.style.height = rows.length * ROW_HEIGHT + 'px';
    firstRendered = -1;
    lastRendered = -1;
    renderedFocus = -2;
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
    renderedFocus = -2;
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

  // True when a node with this id exists anywhere in the (rebuilt) tree.
  function hasNode(nodes, id) {
    return nodes.some((n) => n.id === id || (n.children !== undefined && hasNode(n.children, id)));
  }

  // Installs a rebuilt tree. The selection is kept only if its node id is in the new tree
  // (tested against the tree, not the disk); otherwise it is cleared and null is announced
  // after the re-render. Does nothing to the selection when nothing is selected.
  function replaceTree(folders, files, keepSelection) {
    tree = TreeModel.buildTree(folders, files);
    const clear = selectedId !== null && !(keepSelection && hasNode(tree, selectedId));
    if (clear) selectedId = null;
    relayout();
    if (clear) announceSelection(null);
    document.dispatchEvent(new CustomEvent('tree-updated'));
  }

  function show(folders, files) {
    expanded = new Set();
    focusedId = null;
    domIds.clear();
    container.scrollTop = 0;
    replaceTree(folders, files, false);
  }

  // Replaces the data but keeps the expanded folders and scroll position (used after a rescan).
  function update(folders, files) {
    replaceTree(folders, files, true);
  }

  container.addEventListener('scroll', renderWindow);
  container.setAttribute('role', 'tree');
  container.tabIndex = 0;
  container.addEventListener('keydown', onKeyDown);

  window.TreeView = { show, update };
})();
