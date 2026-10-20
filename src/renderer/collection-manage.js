'use strict';

/*
 * Management panel for the selected collection (FR-1: rename, FR-3: folder list and
 * Remove folder, no confirmation). Removing a folder of the shown collection refreshes the tree
 * in place with TreeView.update (the selection survives only if its node still exists). It manages the
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
  const folderList = document.querySelector('[data-testid="manage-folders"]');

  let managedId = null;
  let loadToken = 0;
  let renaming = false;
  let removing = false;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function sync() {
    const active = managedId !== null;
    panel.hidden = !active;
    renameInput.disabled = !active || renaming;
    renameButton.disabled = !active || renaming;
    for (const button of folderList.querySelectorAll('button')) button.disabled = !active || removing;
  }

  // folders: [{ id, path, unavailable }] as in the summaries and in the view.
  function renderFolders(folders) {
    folderList.replaceChildren(
      ...folders.map((folder) => {
        const li = document.createElement('li');
        li.dataset.testid = 'manage-folder';
        li.dataset.folderId = folder.id;
        const pathEl = document.createElement('span');
        pathEl.dataset.testid = 'manage-folder-path';
        pathEl.textContent = folder.path;
        li.append(pathEl);
        if (folder.unavailable) {
          const label = document.createElement('span');
          label.className = 'manage-unavailable';
          label.dataset.testid = 'manage-folder-unavailable';
          label.textContent = 'unavailable';
          li.append(' ', label);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.testid = 'remove-folder';
        button.textContent = 'Remove';
        button.addEventListener('click', () => removeFolder(folder.id));
        li.append(' ', button);
        return li;
      }),
    );
    sync();
  }

  async function select(collectionId) {
    const token = ++loadToken;
    managedId = collectionId;
    showError('');
    renameInput.value = '';
    renderFolders([]);
    if (collectionId === null) return;
    const result = await api.listCollections();
    if (token !== loadToken) return;
    if (!result.ok) return showError(result.error);
    const summary = result.summaries.find((s) => s.id === collectionId);
    if (!summary) return;
    renameInput.value = summary.name;
    renderFolders(summary.folders);
  }

  async function removeFolder(folderId) {
    if (managedId === null || removing) return;
    const collectionId = managedId;
    showError('');
    removing = true;
    sync();
    try {
      const result = await api.removeFolder(collectionId, folderId);
      if (!result.ok) return showError(result.error);
      if (managedId === collectionId) {
        renderFolders(result.view.folders);
        window.TreeView.update(result.view.folders, result.view.files);
      }
      document.dispatchEvent(new CustomEvent('collections-changed', { detail: { collectionId } }));
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    } finally {
      removing = false;
      sync();
    }
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
