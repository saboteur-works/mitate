'use strict';

/*
 * Management panel for the selected collection (FR-2: Delete collection, confirmed in the main process; FR-1: rename, FR-3: folder list and
 * Remove folder, no confirmation; FR-7: Add folder through the folder picker, one collections:addFolder
 * call per picked folder, in pick order, the collection marked busy meanwhile). Removing a folder of the shown collection refreshes the tree
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
  const addButton = document.querySelector('[data-testid="add-folder-button"]');
  const deleteButton = document.querySelector('[data-testid="delete-collection-button"]');
  const errorBox = document.querySelector('[data-testid="manage-error"]');
  const folderList = document.querySelector('[data-testid="manage-folders"]');

  let managedId = null;
  let loadToken = 0;
  let renaming = false;
  let removing = false;
  let adding = false;
  let deleting = false;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function sync() {
    const active = managedId !== null;
    panel.hidden = !active;
    renameInput.disabled = !active || renaming;
    renameButton.disabled = !active || renaming;
    addButton.disabled = !active || adding;
    deleteButton.disabled = !active || deleting;
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
      showView(collectionId, result.view);
      document.dispatchEvent(new CustomEvent('collections-changed', { detail: { collectionId } }));
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    } finally {
      removing = false;
      sync();
    }
  }

  // Shows a view returned by the main process for the collection the panel manages.
  function showView(collectionId, view) {
    if (managedId !== collectionId) return;
    renderFolders(view.folders);
    window.TreeView.update(view.folders, view.files);
  }

  // Picks folders, then adds them one by one in pick order; the first failure
  // stops the rest and is shown. A cancelled overlap confirmation adds nothing
  // for that folder and is not an error.
  async function addFolders() {
    if (managedId === null || adding) return;
    const collectionId = managedId;
    showError('');
    adding = true;
    sync();
    let began = false;
    try {
      const picked = await api.pickFolders();
      if (picked.canceled || picked.paths.length === 0) return;
      began = window.CollectionBusy.begin(collectionId);
      let changed = false;
      try {
        for (const dirPath of picked.paths) {
          const result = await api.addFolder(collectionId, dirPath);
          if (!result.ok) {
            showError(result.error);
            break;
          }
          if (result.canceled) continue;
          changed = true;
          showView(collectionId, result.view);
        }
      } finally {
        if (changed) document.dispatchEvent(new CustomEvent('collections-changed', { detail: { collectionId } }));
      }
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    } finally {
      if (began) window.CollectionBusy.end(collectionId);
      adding = false;
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

  // The confirmation is asked by the main process. A cancel changes nothing; a delete
  // announces 'collection-deleted' (the page clears the tree and selection if it was the
  // shown collection) and then 'collections-changed' so the list refreshes.
  async function deleteCollection() {
    if (managedId === null || deleting) return;
    const collectionId = managedId;
    showError('');
    deleting = true;
    sync();
    try {
      const result = await api.deleteCollection(collectionId);
      if (!result.ok) return showError(result.error);
      if (result.canceled) return;
      document.dispatchEvent(new CustomEvent('collection-deleted', { detail: { collectionId } }));
      document.dispatchEvent(new CustomEvent('collections-changed', { detail: { collectionId } }));
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    } finally {
      deleting = false;
      sync();
    }
  }

  deleteButton.addEventListener('click', deleteCollection);
  renameButton.addEventListener('click', rename);
  addButton.addEventListener('click', addFolders);
  renameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') rename();
  });
  document.addEventListener('collection-selected', (event) => select(event.detail.collectionId));
  sync();
})();
