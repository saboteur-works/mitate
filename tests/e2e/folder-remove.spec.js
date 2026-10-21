'use strict';

/*
 * Remove folder in the management panel e2e (Feature 3, Task 17; FR-3, FR-13). Collections are
 * written to <userDataDir>/store.json before launch with the real service + scanner. Removing a
 * folder must update the list, the tree and the store at once, with no rescan, no confirmation
 * dialog and no change to the files on disk.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, rowAt, selectOnlyCollection, gateChannel, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { CHANNELS } = require('../../src/main/ipc.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const rowPaths = (window) =>
  window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path),
  );

const underRoot = (paths, root) => paths.filter((p) => p === root || p.startsWith(`${root}/`));

const listing = (root) => fs.readdirSync(root, { recursive: true }).sort();

const entryFor = (window, folderPath) =>
  window.getByTestId('manage-folder').filter({
    has: window.getByTestId('manage-folder-path').getByText(folderPath, { exact: true }),
  });

function storedFolderPaths(userDataDir, collectionId) {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  return storage.listFolders(collectionId).map((f) => f.path);
}

test('remove the second folder: list, tree and store update at once, no rescan, no dialog, disk untouched', async () => {
  const userDataDir = newUserDataDir('folder-remove-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    const created = await service.createCollection('Pair', [first.root, second.root]);
    const collectionId = created.collection.id;
    const diskBefore = listing(second.root);

    session = await launchApp(userDataDir);
    let { app, window } = session;
    const byId = (id) => window.getByTestId(id);
    await selectOnlyCollection(window);

    // The panel lists both folders, in order, none marked unavailable.
    await expect(byId('manage-folder')).toHaveCount(2);
    await expect(byId('manage-folder-path').nth(0)).toHaveText(first.root);
    await expect(byId('manage-folder-path').nth(1)).toHaveText(second.root);
    await expect(byId('manage-folder-unavailable')).toHaveCount(0);

    // Expand both roots so both folders' files are in the tree.
    await rowAt(window, first.root).click();
    await rowAt(window, second.root).click();
    const before = await rowPaths(window);
    expect(underRoot(before, first.root).length).toBeGreaterThan(1);
    expect(underRoot(before, second.root).length).toBeGreaterThan(1);

    const rescan = await gateChannel(app, CHANNELS.rescanCollection);
    await stubConfirm(app, []);

    await entryFor(window, second.root).getByTestId('remove-folder').click();

    // At once: the entry, the root and its files are gone; the count text is updated.
    await expect(byId('manage-folder')).toHaveCount(1, { timeout: 2000 });
    await expect(entryFor(window, second.root)).toHaveCount(0);
    await expect(rowAt(window, second.root)).toHaveCount(0);
    await expect(byId('collection-item')).toContainText('(1 folders)');
    await expect(byId('manage-error')).toBeHidden();
    const after = await rowPaths(window);
    expect(underRoot(after, second.root)).toEqual([]);
    expect(after.slice(0, underRoot(before, first.root).length)).toEqual(underRoot(before, first.root));

    expect(await rescan.calls()).toBe(0);
    expect(await confirmCalls(app)).toEqual([]);
    expect(listing(second.root)).toEqual(diskBefore);

    // Relaunch: the removed folder is not in the list, the tree or the store.
    await app.close();
    expect(storedFolderPaths(userDataDir, collectionId)).toEqual([first.root]);
    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await selectOnlyCollection(window);
    await expect(window.getByTestId('manage-folder')).toHaveCount(1);
    await expect(entryFor(window, first.root)).toHaveCount(1);
    await expect(rowAt(window, second.root)).toHaveCount(0);
    await expect(rowAt(window, first.root)).toHaveCount(1);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(first.root);
    cleanupFixtureTree(second.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('an unavailable folder is labelled in the panel and can be removed', async () => {
  const userDataDir = newUserDataDir('folder-remove-unavail-e2e');
  const first = buildFixtureTree();
  const missing = path.join(os.tmpdir(), `mitate-missing-${path.basename(userDataDir)}`);
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    const { collection } = await service.createCollection('Mixed', [first.root]);
    storage.putFolder({ id: 'gone-1', collectionId: collection.id, path: missing, unavailable: true });
    storage.putCollection({ ...storage.getCollection(collection.id), folderIds: [...storage.getCollection(collection.id).folderIds, 'gone-1'] });

    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);
    await expect(window.getByTestId('manage-folder')).toHaveCount(2);
    await expect(entryFor(window, missing).getByTestId('manage-folder-unavailable')).toHaveText('unavailable');
    await expect(entryFor(window, first.root).getByTestId('manage-folder-unavailable')).toHaveCount(0);

    await entryFor(window, missing).getByTestId('remove-folder').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(1, { timeout: 2000 });
    await expect(window.getByTestId('manage-folder-unavailable')).toHaveCount(0);
    await expect(window.getByTestId('unavailable')).toHaveCount(0);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(first.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
