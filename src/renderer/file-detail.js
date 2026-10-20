'use strict';

/*
 * File detail area (FR-3, FR-4, FR-5, FR-10, FR-11). Driven by the
 * `file-selected` event tree-view.js dispatches on document (detail.file is the
 * selected file or null). The shared FileDetail model decides what to show; the
 * path is written with textContent, never innerHTML. Folder clicks dispatch no
 * event, so they leave the area unchanged. The Reveal button is a native
 * button; its click action is not wired here.
 */
(function () {
  const pathEl = document.querySelector('[data-testid="file-path"]');
  const reveal = document.querySelector('[data-testid="reveal"]');

  function render(file) {
    const view = globalThis.FileDetail.describeSelection(file);
    pathEl.textContent = view.pathText || view.emptyText;
    pathEl.classList.toggle('file-path-empty', view.pathText === '');
    reveal.disabled = view.revealDisabled;
  }

  document.addEventListener('file-selected', (e) => render(e.detail ? e.detail.file : null));
  render(null);
})();
