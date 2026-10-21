'use strict';

(function () {
  const api = window.mediaOrganizer;
  const nameInput = document.querySelector('[data-testid="collection-name"]');
  const addButton = document.querySelector('[data-testid="add-folder"]');
  const createButton = document.querySelector('[data-testid="create-collection"]');
  const folderList = document.querySelector('[data-testid="folder-list"]');
  const collectionList = document.querySelector('[data-testid="collection-list"]');
  const errorBox = document.querySelector('[data-testid="create-error"]');
  const noticeBox = document.querySelector('[data-testid="create-notice"]');

  let folders = [];

  const messageOf = (err) => (err && err.message ? err.message : String(err));

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  // FR-8: tells which nested picks were left out of the created collection.
  function showNotice(message) {
    noticeBox.textContent = message;
    noticeBox.hidden = !message;
  }

  function renderFolders() {
    folderList.replaceChildren(
      ...folders.map((folder) => {
        const li = document.createElement('li');
        li.dataset.testid = 'folder-item';
        li.textContent = folder;
        return li;
      }),
    );
  }

  function renderCollections(summaries) {
    collectionList.replaceChildren(
      ...summaries.map(({ id, name: collectionName, folderCount }) => {
        const li = document.createElement('li');
        li.dataset.testid = 'collection-item';
        li.dataset.collectionId = id;
        li.classList.toggle('collection-selected', id === selectedCollectionId);
        const name = document.createElement('span');
        name.dataset.testid = 'collection-name-label';
        name.textContent = collectionName;
        const count = document.createElement('span');
        count.dataset.testid = 'collection-folder-count';
        count.textContent = String(folderCount);
        li.append(name, ' (', count, ' folders)');
        li.addEventListener('click', () => selectCollection(id));
        return li;
      }),
    );
  }

  // Id of the collection whose tree is displayed, and a token that orders
  // selectCollection calls: a view response is applied only if no later call
  // has started, so a slow earlier response cannot overwrite a newer tree.
  let selectedCollectionId = null;
  let latestSelectToken = 0;

  function highlightSelected() {
    for (const item of collectionList.children) {
      item.classList.toggle('collection-selected', item.dataset.collectionId === selectedCollectionId);
    }
  }

  async function selectCollection(collectionId) {
    const token = ++latestSelectToken;
    const result = await api.getCollectionView(collectionId);
    if (token !== latestSelectToken) return;
    if (!result.ok) return showError(result.error);
    selectedCollectionId = collectionId;
    highlightSelected();
    window.TreeView.show(result.view.folders, result.view.files);
    document.dispatchEvent(new CustomEvent('collection-selected', { detail: { collectionId } }));
  }

  async function refreshCollections() {
    const result = await api.listCollections();
    if (!result.ok) return showError(result.error);
    renderCollections(result.summaries);
  }

  addButton.addEventListener('click', async () => {
    showError('');
    showNotice('');
    const result = await api.pickFolders();
    if (result.canceled) return;
    for (const p of result.paths) if (!folders.includes(p)) folders.push(p);
    renderFolders();
  });

  // True while a create is in flight. The button is disabled too, but the flag
  // also covers a click event that was already queued before the disable.
  let creating = false;

  createButton.addEventListener('click', async () => {
    if (creating) return;
    showError('');
    showNotice('');
    if (nameInput.value.trim() === '') return showError('Collection name must not be empty');
    creating = true;
    createButton.disabled = true;
    try {
      const result = await api.createCollection(nameInput.value, folders);
      if (!result.ok) return showError(result.error);
      folders = [];
      nameInput.value = '';
      renderFolders();
      await refreshCollections();
      // FR-8: nested picks that were left out; the text comes from the main process.
      showNotice(result.notice || '');
    } catch (err) {
      showError(messageOf(err));
    } finally {
      creating = false;
      createButton.disabled = false;
    }
  });

  // The shown collection was deleted: clear the tree (which announces a cleared file
  // selection) and announce that no collection is selected. A pending select is
  // invalidated so it cannot bring the deleted collection back.
  document.addEventListener('collection-deleted', (event) => {
    if (event.detail.collectionId !== selectedCollectionId) return;
    latestSelectToken++;
    selectedCollectionId = null;
    highlightSelected();
    window.TreeView.show([], []);
    document.dispatchEvent(new CustomEvent('collection-selected', { detail: { collectionId: null } }));
  });

  document.addEventListener('collections-changed', refreshCollections);

  refreshCollections();
})();
