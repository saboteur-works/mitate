'use strict';

// Pure rules for the view tab row: the tab list, the WAI-ARIA tabs keys and
// the empty-list text. No DOM. Wording lives here so the UI and the e2e tests
// agree.

// The body is wrapped so a classic <script> load leaks only `TabsModel`.
(function () {
  const TABS = Object.freeze([
    Object.freeze({ id: 'tree', label: 'Tree' }),
    Object.freeze({ id: 'image', label: 'Images' }),
    Object.freeze({ id: 'audio', label: 'Audio' }),
    Object.freeze({ id: 'video', label: 'Video' }),
    Object.freeze({ id: 'document', label: 'Documents' }),
  ]);

  // The tab index a key moves to, or null when the key is not a tab key.
  // ArrowLeft and ArrowRight wrap; Home and End go to the first and last tab.
  function nextTab(index, key, count) {
    if (!Number.isInteger(count) || count < 1) return null;
    switch (key) {
      case 'ArrowRight':
        return (index + 1) % count;
      case 'ArrowLeft':
        return (index - 1 + count) % count;
      case 'Home':
        return 0;
      case 'End':
        return count - 1;
      default:
        return null;
    }
  }

  // Text for a list with no files. `kind` is a file kind, not 'tree'.
  function emptyText(kind) {
    const isKind = TABS.some((t) => t.id === kind && t.id !== 'tree');
    if (!isKind) throw new Error(`no empty text for view: ${kind}`);
    return `No ${kind} files in this collection`;
  }

  const TabsModel = { TABS, nextTab, emptyText };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TabsModel;
  } else {
    globalThis.TabsModel = TabsModel;
  }
})();
