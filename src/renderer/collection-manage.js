'use strict';

/*
 * Management panel for the selected collection.
 * - FR-1: rename. The main process validates the name; this file only shows
 *   what it answers.
 * - FR-2: Delete collection, confirmed in the main process.
 * - FR-3: folder list and Remove folder, no confirmation. Removing a folder of
 *   the shown collection refreshes the tree in place with TreeView.update (the
 *   selection survives only if its node still exists).
 * - FR-7: Add folder through the folder picker, one collections:addFolders call
 *   for all picked folders, the collection marked busy meanwhile. The main process
 *   drops picks inside another pick and adds the rest in pick order.
 * - FR-8: a refused add (FOLDER_COVERED) is shown in manage-error; an add that
 *   replaced contained folders is reported in manage-notice.
 * - FR-12: all four controls are disabled while the managed collection is busy,
 *   following 'collection-busy-changed'.
 * It manages the collection that 'collection-selected' last announced and hides
 * itself when the announcement carries collectionId null. After a successful
 * action it dispatches 'collections-changed' on document (detail.collectionId)
 * so the collection list can refresh. A result that arrives after the user switched
 * to another collection shows no error, notice or panel change.
 */
(function () {
  const api = window.mediaOrganizer;
  const panel = document.querySelector('[data-testid="manage-panel"]');
  const renameInput = document.querySelector('[data-testid="rename-input"]');
  const renameButton = document.querySelector('[data-testid="rename-button"]');
  const addButton = document.querySelector('[data-testid="add-folder-button"]');
  const deleteButton = document.querySelector('[data-testid="delete-collection-button"]');
  const errorBox = document.querySelector('[data-testid="manage-error"]');
  const noticeBox = document.querySelector('[data-testid="manage-notice"]');
  const folderList = document.querySelector('[data-testid="manage-folders"]');
  const messageOf = (err) => (err && err.message ? err.message : String(err));

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

  // Shows an error only while the panel still manages the collection the action was for.
  function showErrorFor(collectionId, message) {
    if (managedId === collectionId) showError(message);
  }

  // FR-8: tells which folders a confirmed add replaced. Cleared by the next action in the panel.
  function showNotice(message) {
    noticeBox.textContent = message;
    noticeBox.hidden = !message;
  }

  // Shows a notice only while the panel still manages the collection the action was for.
  function showNoticeFor(collectionId, message) {
    if (managedId === collectionId) showNotice(message);
  }

  // FR-12: true while a rescan or add-folder scan of the managed collection runs. The main
  // process refuses the same actions with COLLECTION_BUSY; disabling is the renderer half.
  const isBusy = () => managedId !== null && window.CollectionBusy.isBusy(managedId);

  function sync() {
    const active = managedId !== null;
    const busy = isBusy();
    panel.hidden = !active;
    renameInput.disabled = !active || renaming || busy;
    renameButton.disabled = !active || renaming || busy;
    addButton.disabled = !active || adding || busy;
    deleteButton.disabled = !active || deleting || busy;
    const removeOff = !active || removing || busy;
    for (const button of folderList.querySelectorAll('button')) button.disabled = removeOff;
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
    showNotice('');
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
    if (managedId === null || removing || isBusy()) return;
    const collectionId = managedId;
    showError('');
    showNotice('');
    removing = true;
    sync();
    try {
      const result = await api.removeFolder(collectionId, folderId);
      if (!result.ok) return showErrorFor(collectionId, result.error);
      showView(collectionId, result.view);
      document.dispatchEvent(new CustomEvent('collections-changed', { detail: { collectionId } }));
    } catch (err) {
      showErrorFor(collectionId, messageOf(err));
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

  // Picks folders, then adds them with one collections:addFolders call. The main process
  // drops picks inside another pick, adds the rest in pick order and stops at the first
  // failure (a FOLDER_COVERED refusal included): the folders added before it stay, the
  // view so far comes back with the error. A cancelled replace confirmation adds nothing
  // for that folder and is not an error. result.notice names replaced and dropped folders.
  async function addFolders() {
    if (managedId === null || adding || isBusy()) return;
    const collectionId = managedId;
    showError('');
    showNotice('');
    adding = true;
    sync();
    let began = false;
    try {
      const picked = await api.pickFolders();
      if (picked.canceled || picked.paths.length === 0) return;
      began = window.CollectionBusy.begin(collectionId, 'add-folder');
      const result = await api.addFolders(collectionId, picked.paths);
      if (result.view) {
        showView(collectionId, result.view);
        document.dispatchEvent(new CustomEvent('collections-changed', { detail: { collectionId } }));
      }
      showNoticeFor(collectionId, result.notice || '');
      if (!result.ok) showErrorFor(collectionId, result.error);
    } catch (err) {
      showErrorFor(collectionId, messageOf(err));
    } finally {
      if (began) window.CollectionBusy.end(collectionId);
      adding = false;
      sync();
    }
  }

  async function rename() {
    if (managedId === null || renaming || isBusy()) return;
    const collectionId = managedId;
    showError('');
    showNotice('');
    renaming = true;
    sync();
    try {
      const result = await api.renameCollection(collectionId, renameInput.value);
      if (!result.ok) return showErrorFor(collectionId, result.error);
      if (managedId === collectionId) renameInput.value = result.summary.name;
      document.dispatchEvent(new CustomEvent('collections-changed', { detail: { collectionId } }));
    } catch (err) {
      showErrorFor(collectionId, messageOf(err));
    } finally {
      renaming = false;
      sync();
    }
  }

  // The confirmation is asked by the main process. A cancel changes nothing; a delete
  // announces 'collection-deleted' (the page clears the tree and selection if it was the
  // shown collection) and then 'collections-changed' so the list refreshes.
  async function deleteCollection() {
    if (managedId === null || deleting || isBusy()) return;
    const collectionId = managedId;
    showError('');
    showNotice('');
    deleting = true;
    sync();
    try {
      const result = await api.deleteCollection(collectionId);
      if (!result.ok) return showErrorFor(collectionId, result.error);
      if (result.canceled) return;
      document.dispatchEvent(new CustomEvent('collection-deleted', { detail: { collectionId } }));
      document.dispatchEvent(new CustomEvent('collections-changed', { detail: { collectionId } }));
    } catch (err) {
      showErrorFor(collectionId, messageOf(err));
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
  document.addEventListener('collection-busy-changed', sync);
  sync();
})();
