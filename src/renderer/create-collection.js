'use strict';

(function () {
  const api = window.mediaOrganizer;
  const nameInput = document.querySelector('[data-testid="collection-name"]');
  const addButton = document.querySelector('[data-testid="add-folder"]');
  const createButton = document.querySelector('[data-testid="create-collection"]');
  const folderList = document.querySelector('[data-testid="folder-list"]');
  const collectionList = document.querySelector('[data-testid="collection-list"]');
  const errorBox = document.querySelector('[data-testid="create-error"]');

  let folders = [];

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
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

  function renderCollections(views) {
    collectionList.replaceChildren(
      ...views.map(({ collection, folders: folderRecords }) => {
        const li = document.createElement('li');
        li.dataset.testid = 'collection-item';
        const name = document.createElement('span');
        name.dataset.testid = 'collection-name-label';
        name.textContent = collection.name;
        const count = document.createElement('span');
        count.dataset.testid = 'collection-folder-count';
        count.textContent = String(folderRecords.length);
        li.append(name, ' (', count, ' folders)');
        li.addEventListener('click', () => selectCollection(collection.id, li));
        return li;
      }),
    );
  }

  async function selectCollection(collectionId, li) {
    const result = await api.getCollectionView(collectionId);
    if (!result.ok) return showError(result.error);
    for (const item of collectionList.children) item.classList.remove('collection-selected');
    li.classList.add('collection-selected');
    window.TreeView.show(result.view.folders, result.view.files);
    document.dispatchEvent(new CustomEvent('collection-selected', { detail: { collectionId } }));
  }

  async function refreshCollections() {
    const result = await api.listCollections();
    if (!result.ok) return showError(result.error);
    renderCollections(result.views);
  }

  addButton.addEventListener('click', async () => {
    showError('');
    const result = await api.pickFolders();
    if (result.canceled) return;
    for (const p of result.paths) if (!folders.includes(p)) folders.push(p);
    renderFolders();
  });

  createButton.addEventListener('click', async () => {
    showError('');
    if (nameInput.value.trim() === '') return showError('Collection name must not be empty');
    const result = await api.createCollection(nameInput.value, folders);
    if (!result.ok) return showError(result.error);
    folders = [];
    nameInput.value = '';
    renderFolders();
    await refreshCollections();
  });

  refreshCollections();
})();
