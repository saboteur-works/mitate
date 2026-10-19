'use strict';

/*
 * Rescan button (FR-20 interface). The button is enabled once a collection is
 * selected (create-collection.js dispatches 'collection-selected' on document).
 * Clicking it calls api.rescanCollection(id) and re-renders the tree keeping the
 * expanded folders. Nothing here runs a scan on load.
 */
(function () {
  const api = window.mediaOrganizer;
  const button = document.querySelector('[data-testid="rescan"]');
  const status = document.querySelector('[data-testid="rescan-status"]');
  let selectedId = null;

  document.addEventListener('collection-selected', (event) => {
    selectedId = event.detail.collectionId;
    button.disabled = false;
    status.textContent = '';
  });

  button.addEventListener('click', async () => {
    const id = selectedId;
    if (id === null) return;
    button.disabled = true;
    status.textContent = 'Rescanning...';
    try {
      const result = await api.rescanCollection(id);
      if (!result.ok) {
        status.textContent = `Rescan failed: ${result.error}`;
        return;
      }
      if (selectedId === id) window.TreeView.update(result.view.folders, result.view.files);
      const { rescanned, skipped } = result.summary;
      status.textContent = `Rescanned ${rescanned.length} folders, skipped ${skipped.length}`;
    } catch (err) {
      status.textContent = `Rescan failed: ${err && err.message ? err.message : String(err)}`;
    } finally {
      button.disabled = selectedId === null;
    }
  });
})();
