'use strict';

/*
 * Rescan button (FR-20 interface). The button is enabled once a collection is
 * selected (create-collection.js dispatches 'collection-selected' on document).
 * Clicking it calls api.rescanCollection(id) and re-renders the tree keeping the
 * expanded folders. Nothing here runs a scan on load.
 *
 * In-flight rescans are tracked per collection id: the button is disabled while
 * the SELECTED collection has a rescan running (also after selecting another
 * collection and coming back), and a result for a collection that is no longer
 * selected is not applied to the tree or status.
 */
(function () {
  const api = window.mediaOrganizer;
  const button = document.querySelector('[data-testid="rescan"]');
  const status = document.querySelector('[data-testid="rescan-status"]');
  const inFlight = new Set();
  let selectedId = null;

  function syncButton() {
    button.disabled = selectedId === null || inFlight.has(selectedId);
  }

  document.addEventListener('collection-selected', (event) => {
    selectedId = event.detail.collectionId;
    status.textContent = inFlight.has(selectedId) ? 'Rescanning...' : '';
    syncButton();
  });

  button.addEventListener('click', async () => {
    const id = selectedId;
    if (id === null || inFlight.has(id)) return;
    inFlight.add(id);
    syncButton();
    status.textContent = 'Rescanning...';
    try {
      const result = await api.rescanCollection(id);
      if (selectedId !== id) return;
      if (!result.ok) {
        status.textContent = `Rescan failed: ${result.error}`;
        return;
      }
      window.TreeView.update(result.view.folders, result.view.files);
      const { rescanned, skipped } = result.summary;
      status.textContent = `Rescanned ${rescanned.length} folders, skipped ${skipped.length}`;
    } catch (err) {
      if (selectedId === id) status.textContent = `Rescan failed: ${err && err.message ? err.message : String(err)}`;
    } finally {
      inFlight.delete(id);
      syncButton();
    }
  });
})();
