'use strict';

/*
 * File detail area (FR-3, FR-4, FR-5, FR-10, FR-11). Driven by the
 * `file-selected` event tree-view.js dispatches on document (detail.file is the
 * selected file or null). The shared FileDetail model decides what to show; the
 * path is written with textContent, never innerHTML. Folder clicks dispatch no
 * event, so they leave the area unchanged. The Reveal button is a native
 * button; a click calls window.mediaOrganizer.revealFile(path) once. A returned
 * { ok: false, error } or a rejected promise is shown in the reveal-error
 * element (main-process text unchanged); the error is cleared on every
 * selection change and on every `tree-updated` event (tree show/update, e.g. a rescan);
 * a reveal response that was in flight when either happened is ignored. The button stays disabled while a call is in flight, and a
 * response that arrives after the selection changed is ignored.
 */
(function () {
  const pathEl = document.querySelector('[data-testid="file-path"]');
  const reveal = document.querySelector('[data-testid="reveal"]');

  const errorEl = document.querySelector('[data-testid="reveal-error"]');
  let current = null;
  let inFlight = false;
  let epoch = 0; // bumped on every selection change or tree refresh

  function setError(text) {
    errorEl.textContent = text;
    errorEl.hidden = text === '';
  }

  function render(file) {
    const view = globalThis.FileDetail.describeSelection(file);
    epoch += 1;
    current = view.pathText === '' ? null : file;
    pathEl.textContent = view.pathText || view.emptyText;
    pathEl.classList.toggle('file-path-empty', view.pathText === '');
    reveal.disabled = view.revealDisabled || inFlight;
    setError('');
  }

  async function onReveal() {
    if (!current || inFlight) return;
    const requested = current;
    const startedAt = epoch;
    inFlight = true;
    reveal.disabled = true;
    let message = '';
    try {
      const result = await window.mediaOrganizer.revealFile(requested.path);
      if (result && result.ok === false) message = String(result.error || 'Reveal failed');
    } catch (err) {
      message = (err && err.message) || String(err);
    }
    inFlight = false;
    reveal.disabled = current === null;
    if (current === requested && epoch === startedAt) setError(message);
  }

  reveal.addEventListener('click', onReveal);
  document.addEventListener('file-selected', (e) => render(e.detail ? e.detail.file : null));
  document.addEventListener('tree-updated', () => {
    epoch += 1;
    setError('');
  });
  render(null);
})();
