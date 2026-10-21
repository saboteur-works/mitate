'use strict';

/*
 * Rescan button (FR-20 interface). The button is enabled once a collection is
 * selected (create-collection.js dispatches 'collection-selected' on document).
 * Clicking it calls api.rescanCollection(id) and re-renders the tree keeping the
 * expanded folders. Nothing here runs a scan on load.
 *
 * In-flight rescans are tracked per collection id in window.CollectionBusy
 * (collection-busy.js, shared with other controls): the button is disabled while
 * the SELECTED collection has a rescan running (also after selecting another
 * collection and coming back), and a result for a collection that is no longer
 * selected is not applied to the tree or status.
 */
(function () {
  const api = window.mediaOrganizer;
  const button = document.querySelector('[data-testid="rescan"]');
  const status = document.querySelector('[data-testid="rescan-status"]');
  const busy = window.CollectionBusy;
  let selectedId = null;

  const messageOf = (err) => (err && err.message ? err.message : String(err));

  function fail(message) {
    status.textContent = `Rescan failed: ${message}`;
  }

  function syncButton() {
    button.disabled = selectedId === null || busy.isBusy(selectedId);
  }

  document.addEventListener('collection-selected', (event) => {
    selectedId = event.detail.collectionId;
    status.textContent = busy.holder(selectedId) === 'rescan' ? 'Rescanning...' : '';
    syncButton();
  });

  // Selection sets the text from the holder; the rescan's own result text is set before
  // its busy state ends, so only the button needs to follow busy changes.
  document.addEventListener('collection-busy-changed', syncButton);

  button.addEventListener('click', async () => {
    const id = selectedId;
    if (id === null || !busy.begin(id, 'rescan')) return;
    syncButton();
    status.textContent = 'Rescanning...';
    try {
      const result = await api.rescanCollection(id);
      if (selectedId !== id) return;
      if (!result.ok) return fail(result.error);
      window.TreeView.update(result.view.folders, result.view.files);
      const { rescanned, skipped } = result.summary;
      status.textContent = `Rescanned ${rescanned.length} folders, skipped ${skipped.length}`;
    } catch (err) {
      if (selectedId === id) fail(messageOf(err));
    } finally {
      busy.end(id);
      syncButton();
    }
  });
})();
