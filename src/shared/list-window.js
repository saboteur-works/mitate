'use strict';

// Pure windowing arithmetic for a virtualized list. No DOM. Given the scroll
// position, the viewport height and the row count, it says which rows to put
// in the DOM, so the element count depends on the viewport and the buffer and
// never on the number of rows. The spacer height gives the scrollbar the range
// of the whole list.
//
// Defaults match the tree view (24px rows, 5 rows of buffer). Row indexes are
// zero based. With no rows, first is 0, last is -1 and count is 0.

// The body is wrapped so a classic <script> load leaks only `ListWindow`.
(function () {
  const ROW_HEIGHT = 24;
  const BUFFER = 5;

  function num(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function normalise(opts) {
    const o = opts || {};
    return {
      rowCount: Math.max(0, Math.floor(num(o.rowCount, 0))),
      rowHeight: Math.max(1, num(o.rowHeight, ROW_HEIGHT)),
      buffer: Math.max(0, Math.floor(num(o.buffer, BUFFER))),
      viewportHeight: Math.max(0, num(o.viewportHeight, 0)),
      scrollTop: num(o.scrollTop, 0),
    };
  }

  // Greatest scrollTop the container can reach.
  function maxScrollTop({ rowCount, rowHeight, viewportHeight }) {
    return Math.max(0, rowCount * rowHeight - viewportHeight);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // { first, last, count, spacerHeight, scrollTop } for the rows to render.
  // scrollTop is the input clamped to the reachable range.
  function windowFor(opts) {
    const o = normalise(opts);
    const spacerHeight = o.rowCount * o.rowHeight;
    const scrollTop = clamp(o.scrollTop, 0, maxScrollTop(o));
    if (o.rowCount === 0) return { first: 0, last: -1, count: 0, spacerHeight, scrollTop };
    const first = Math.max(0, Math.floor(scrollTop / o.rowHeight) - o.buffer);
    const lastVisible = Math.ceil((scrollTop + o.viewportHeight) / o.rowHeight) - 1;
    const last = Math.min(o.rowCount - 1, Math.max(first, lastVisible + o.buffer));
    return { first, last, count: last - first + 1, spacerHeight, scrollTop };
  }

  // Offset of a row's top edge inside the spacer.
  function rowTop(index, rowHeight) {
    return index * Math.max(1, num(rowHeight, ROW_HEIGHT));
  }

  // The scrollTop that brings row `index` fully into view, or the current
  // scrollTop when it already is. An out-of-range index is clamped.
  function ensureVisible(index, opts) {
    const o = normalise(opts);
    if (o.rowCount === 0) return 0;
    const current = clamp(o.scrollTop, 0, maxScrollTop(o));
    const i = clamp(Math.floor(num(index, 0)), 0, o.rowCount - 1);
    const top = i * o.rowHeight;
    const bottom = top + o.rowHeight;
    if (top < current) return top;
    if (bottom > current + o.viewportHeight) return clamp(bottom - o.viewportHeight, 0, maxScrollTop(o));
    return current;
  }

  const ListWindow = { windowFor, rowTop, ensureVisible, maxScrollTop: (opts) => maxScrollTop(normalise(opts)), ROW_HEIGHT, BUFFER };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ListWindow;
  } else {
    globalThis.ListWindow = ListWindow;
  }
})();
