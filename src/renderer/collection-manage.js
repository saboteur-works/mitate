'use strict';

/*
 * Management panel for the selected collection (FR-1: rename). It manages the
 * collection that 'collection-selected' last announced and hides itself when
 * the announcement carries collectionId null. After a successful action it
 * dispatches 'collections-changed' on document (detail.collectionId) so the
 * collection list can refresh. The main process validates the name; this file
 * only shows what it answers.
 */
(function () {
  const api = window.mediaOrganizer;
  const panel = document.querySelector('[data-testid="manage-panel"]');
  const renameInput = document.querySelector('[data-testid="rename-input"]');
  const renameButton = document.querySelector('[data-testid="rename-button"]');
  const errorBox = document.querySelector('[data-testid="manage-error"]');

  let managedId = null;
  let loadToken = 0;
  let renaming = false;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function sync() {
    const active = managedId !== null;
    panel.hidden = !active;
    renameInput.disabled = !active || renaming;
    renameButton.disabled = !active || renaming;
  }

  async function select(collectionId) {
    const token = ++loadToken;
    managedId = collectionId;
    showError('');
    renameInput.value = '';
    sync();
    if (collectionId === null) return;
    const result = await api.listCollections();
    if (token !== loadToken) return;
    if (!result.ok) return showError(result.error);
    const summary = result.summaries.find((s) => s.id === collectionId);
    if (summary) renameInput.value = summary.name;
  }

  async function rename() {
    if (managedId === null || renaming) return;
    const collectionId = managedId;
    showError('');
    renaming = true;
    sync();
    try {
      const result = await api.renameCollection(collectionId, renameInput.value);
      if (!result.ok) return showError(result.error);
      if (managedId === collectionId) renameInput.value = result.summary.name;
      document.dispatchEvent(new CustomEvent('collections-changed', { detail: { collectionId } }));
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    } finally {
      renaming = false;
      sync();
    }
  }

  renameButton.addEventListener('click', rename);
  renameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') rename();
  });
  document.addEventListener('collection-selected', (event) => select(event.detail.collectionId));
  sync();
})();
