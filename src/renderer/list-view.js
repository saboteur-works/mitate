'use strict';

/*
 * Virtualized flat list view (Feature 4: FR-3 to FR-8).
 *
 * Renders the rows of one type list (TypeList.buildTypeList rows, global from
 * ../shared/type-list.js) into a container element. The structure is the tree
 * view's: only the rows inside the scroll viewport plus a buffer are in the DOM
 * (ListWindow.windowFor, global from ../shared/list-window.js), a spacer of
 * (row count * ROW_HEIGHT) gives the scrollbar the range of the whole list, and
 * each rendered row is absolutely positioned inside it. The DOM size depends on
 * the viewport height, not on the number of files.
 *
 * Decisions:
 * - One list at a time. render(container, rows, emptyText, options) binds the
 *   view to `container` (adding the .list-view class, role="listbox" and
 *   tabindex 0 on first use) and replaces the displayed rows. The rows array is
 *   kept by reference, never copied.
 * - A row is one line: the name and, dimmed, the folder label. Text is set with
 *   textContent only. A row of an unavailable folder carries the same visible
 *   "unavailable" label the tree uses (data-testid="unavailable"); nothing is hidden.
 * - States: no rows and a non-empty emptyText shows data-testid="list-empty" with that
 *   text; setLoading(true) drops the rows and shows data-testid="list-loading".
 * - Selection: at most one row is selected, held as its node id (selectedId, the id the
 *   tree uses) so it survives virtualized re-renders. Selecting or clearing dispatches
 *   `file-selected` on document with detail.file = { nodeId, path, name, folderId,
 *   relativePath, kind, unavailable } (the tree's shape) or null. render keeps the
 *   selection only if its node id is among the new rows, else clears it and announces null.
 *   clearSelection() announces null only when something was selected.
 * - Keyboard: the container is the single Tab stop (role="listbox", tabindex 0). Focus is a
 *   node id (focusedId); DOM focus stays on the container and aria-activedescendant points at
 *   the focused row (id list-row-<index>), which stays rendered outside the window. ArrowUp
 *   and ArrowDown move one row without wrapping and scroll it into view, Home and End go to
 *   the first and last row, Enter and Space select the focused row. If focusedId is not among
 *   the rows focus falls back to the first row. Clicking a row focuses and selects it.
 * - ROW_HEIGHT 24px (must match .list-row in styles.css), BUFFER 5 rows.
 *
 * API: window.ListView = { render, setLoading, clearSelection }
 *   setLoading(loading, container?)  container binds the view when it has not been rendered yet
 *   render(container, rows, emptyText = '', options = {})
 *     options.reset      true: scroll to the top and focus the first row (a different list)
 *     options.scrollTop  number: scroll position to restore (a refreshed list)
 *   Without options the scroll position is left to the browser (clamped to the new range).
 */
(function () {
  const ROW_HEIGHT = ListWindow.ROW_HEIGHT;
  const BUFFER = ListWindow.BUFFER;

  let container = null;
  let spacer = null;
  let statusEl = null;
  let rows = [];
  let emptyText = '';
  let loading = false;
  let selectedId = null;
  let focusedId = null;
  let focusedIndex = -1;
  let firstRendered = -1;
  let lastRendered = -1;
  let renderedFocus = -2;
  let renderedSelected = null;

  function indexOfId(id) {
    if (id === null) return -1;
    for (let i = 0; i < rows.length; i++) if (rows[i].nodeId === id) return i;
    return -1;
  }

  // Resolves focusedId to an index; falls back to the first row (or -1 when there are none).
  function resolveFocus() {
    const i = indexOfId(focusedId);
    if (i >= 0) focusedIndex = i;
    else {
      focusedIndex = rows.length > 0 ? 0 : -1;
      focusedId = rows.length > 0 ? rows[0].nodeId : null;
    }
  }

  function makeRow(index) {
    const entry = rows[index];
    const row = document.createElement('div');
    const selected = entry.nodeId === selectedId;
    row.className = 'list-row';
    row.classList.toggle('list-focused', index === focusedIndex);
    row.classList.toggle('list-selected', selected);
    row.dataset.testid = 'list-row';
    row.dataset.index = String(index);
    row.dataset.nodeId = entry.nodeId;
    row.dataset.path = entry.path;
    row.id = 'list-row-' + index;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));
    row.style.top = ListWindow.rowTop(index, ROW_HEIGHT) + 'px';
    row.addEventListener('click', () => {
      focusedId = entry.nodeId;
      focusedIndex = index;
      select(entry);
    });
    const name = document.createElement('span');
    name.className = 'list-name';
    name.dataset.testid = 'list-row-name';
    name.textContent = entry.name;
    const folder = document.createElement('span');
    folder.className = 'list-folder';
    folder.dataset.testid = 'list-row-folder';
    folder.textContent = entry.folder;
    row.append(name, folder);
    if (entry.unavailable) {
      const label = document.createElement('span');
      label.className = 'tree-unavailable';
      label.dataset.testid = 'unavailable';
      label.textContent = 'unavailable';
      row.appendChild(label);
    }
    return row;
  }

  function invalidate() {
    firstRendered = -1;
    lastRendered = -1;
    renderedFocus = -2;
    renderedSelected = null;
  }

  function renderWindow() {
    if (container === null) return;
    const w = ListWindow.windowFor({
      scrollTop: container.scrollTop,
      viewportHeight: container.clientHeight,
      rowCount: rows.length,
      rowHeight: ROW_HEIGHT,
      buffer: BUFFER,
    });
    if (w.first === firstRendered && w.last === lastRendered && focusedIndex === renderedFocus && selectedId === renderedSelected) {
      return;
    }
    firstRendered = w.first;
    lastRendered = w.last;
    renderedFocus = focusedIndex;
    renderedSelected = selectedId;
    const nodes = [];
    for (let i = w.first; i <= w.last; i++) nodes.push(makeRow(i));
    // The focused row stays in the DOM (aria-activedescendant target) even outside the window.
    if (focusedIndex >= 0 && (focusedIndex < w.first || focusedIndex > w.last)) nodes.push(makeRow(focusedIndex));
    spacer.replaceChildren(...nodes);
    if (focusedIndex >= 0) container.setAttribute('aria-activedescendant', 'list-row-' + focusedIndex);
    else container.removeAttribute('aria-activedescendant');
  }

  // Shows the loading or the empty text, or neither.
  function syncStatus() {
    if (statusEl !== null) {
      statusEl.remove();
      statusEl = null;
    }
    container.setAttribute('aria-busy', String(loading));
    let testId = null;
    let text = '';
    if (loading) {
      testId = 'list-loading';
      text = 'Loading...';
    } else if (rows.length === 0 && emptyText !== '') {
      testId = 'list-empty';
      text = emptyText;
    }
    if (testId === null) return;
    statusEl = document.createElement('p');
    statusEl.className = 'list-status';
    statusEl.dataset.testid = testId;
    statusEl.textContent = text;
    container.appendChild(statusEl);
  }

  function relayout() {
    spacer.style.height = rows.length * ROW_HEIGHT + 'px';
    resolveFocus();
    invalidate();
    renderWindow();
    syncStatus();
  }

  function announceSelection(file) {
    document.dispatchEvent(new CustomEvent('file-selected', { detail: { file } }));
  }

  function select(entry) {
    if (entry.nodeId === selectedId) {
      renderWindow();
      return;
    }
    selectedId = entry.nodeId;
    invalidate();
    renderWindow();
    announceSelection({
      nodeId: entry.nodeId,
      path: entry.path,
      name: entry.name,
      folderId: entry.folderId,
      relativePath: entry.relativePath,
      kind: entry.kind,
      unavailable: entry.unavailable === true,
    });
  }

  // Moves focus to the row at index and scrolls it just enough into view.
  function moveFocus(index) {
    focusedIndex = index;
    focusedId = rows[index].nodeId;
    container.scrollTop = ListWindow.ensureVisible(index, {
      scrollTop: container.scrollTop,
      viewportHeight: container.clientHeight,
      rowCount: rows.length,
      rowHeight: ROW_HEIGHT,
    });
    renderWindow();
  }

  function onKeyDown(event) {
    if (rows.length === 0) return;
    const last = rows.length - 1;
    const target = {
      ArrowDown: Math.min(last, focusedIndex + 1),
      ArrowUp: Math.max(0, focusedIndex - 1),
      Home: 0,
      End: last,
    }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      moveFocus(target);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(rows[focusedIndex]);
    }
  }

  // Binds the view to a container, once per container.
  function bind(el) {
    if (container === el) return;
    if (container !== null) {
      container.removeEventListener('scroll', renderWindow);
      container.removeEventListener('keydown', onKeyDown);
    }
    container = el;
    container.classList.add('list-view');
    container.setAttribute('role', 'listbox');
    container.tabIndex = 0;
    spacer = document.createElement('div');
    spacer.className = 'list-spacer';
    spacer.dataset.testid = 'list-spacer';
    statusEl = null;
    container.replaceChildren(spacer);
    container.addEventListener('scroll', renderWindow);
    container.addEventListener('keydown', onKeyDown);
    invalidate();
  }

  function render(el, newRows, newEmptyText, options) {
    const opts = options || {};
    bind(el);
    rows = Array.isArray(newRows) ? newRows : [];
    emptyText = typeof newEmptyText === 'string' ? newEmptyText : '';
    loading = false;
    if (opts.reset === true) focusedId = null;
    const clear = selectedId !== null && indexOfId(selectedId) < 0;
    if (clear) selectedId = null;
    spacer.style.height = rows.length * ROW_HEIGHT + 'px';
    if (opts.reset === true) container.scrollTop = 0;
    else if (typeof opts.scrollTop === 'number') container.scrollTop = opts.scrollTop;
    relayout();
    if (clear) announceSelection(null);
  }

  // true: drops the displayed rows and shows the loading text; false: hides the loading text.
  // The selection is kept, so a refresh in place can keep it when the id is still there.
  // Passing `el` binds the view to it first, so the loading state can be shown before any render.
  function setLoading(value, el) {
    if (el) bind(el);
    if (container === null) return;
    loading = value === true;
    if (loading) rows = [];
    relayout();
  }

  function clearSelection() {
    if (selectedId === null) return;
    selectedId = null;
    invalidate();
    renderWindow();
    announceSelection(null);
  }

  window.ListView = { render, setLoading, clearSelection };
})();
