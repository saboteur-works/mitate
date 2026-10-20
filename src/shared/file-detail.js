// Maps the current selection to what the file detail area shows. DOM-free.
// `file` is the selected file entry ({ path, unavailable?, ... }) or null.
// Folders are never shown as a selection: they give no path and keep Reveal
// disabled. The path is returned verbatim (no truncation or ellipsis); wrapping
// and selectability are handled by CSS.

const EMPTY_TEXT = 'Select a file to see its location';

function describeSelection(file) {
  if (!file || typeof file.path !== 'string' || file.type === 'folder') {
    return { pathText: '', emptyText: EMPTY_TEXT, revealDisabled: true };
  }
  return { pathText: file.path, emptyText: '', revealDisabled: false };
}

const FileDetail = { describeSelection, EMPTY_TEXT };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileDetail;
} else {
  globalThis.FileDetail = FileDetail;
}
