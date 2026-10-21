'use strict';

/*
 * The same folder in several collections e2e (Feature 3, Task 25; FR-4, FR-6, FR-13).
 * Collections A (over X) and B (over Y) are written to <userDataDir>/store.json before launch with
 * the real service + scanner; X is added to B through the panel (stubFolderPicker). The store is
 * read from disk only while the app is closed. X is a private copy of the fixture tree, so the
 * file created in it does not leak into other specs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, rowAt, stubFolderPicker, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const listing = (root) => fs.readdirSync(root, { recursive: true }).sort();

const itemNamed = (window, name) =>
  window.getByTestId('collection-item').filter({
    has: window.getByTestId('collection-name-label').getByText(name, { exact: true }),
  });

const entryFor = (window, folderPath) =>
  window.getByTestId('manage-folder').filter({
    has: window.getByTestId('manage-folder-path').getByText(folderPath, { exact: true }),
  });

// Folder records of a collection with the index of each, as stored.
function foldersOf(userDataDir, collectionId) {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  return JSON.parse(JSON.stringify(
    storage.listFolders(collectionId).map((folder) => ({
      folder, index: storage.getIndex({ folderId: folder.id }),
    })),
  ));
}

// The folder of `collectionId` at `folderPath`, with its index.
const folderAt = (userDataDir, collectionId, folderPath) =>
  foldersOf(userDataDir, collectionId).find((f) => f.folder.path === folderPath);

const hasFile = (entry, filePath) => entry.index.some((r) => JSON.stringify(r).includes(filePath));

async function selectCollection(window, name) {
  await itemNamed(window, name).click();
  await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
}

async function rescan(window, count) {
  await window.getByTestId('rescan').click();
  await expect(window.getByTestId('rescan-status')).toContainText(`Rescanned ${count} folders`, { timeout: 30000 });
}

test('one folder in two collections: separate records and indexes, independent rescan, remove and delete', async () => {
  const userDataDir = newUserDataDir('shared-folder-e2e');
  const x = buildFixtureTree();
  const y = buildFixtureTree();
  const added = path.join(x.root, 'added-later.mp3');
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    const { collection: a } = await service.createCollection('Alpha', [x.root]);
    const { collection: b } = await service.createCollection('Beta', [y.root]);
    const diskBefore = listing(x.root);

    // Add X to B through the panel: no confirmation (overlap is checked within one collection).
    session = await launchApp(userDataDir);
    let { app, window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await selectCollection(window, 'Beta');
    await expect(window.getByTestId('manage-folder')).toHaveCount(1);
    const picker = await stubFolderPicker(app, [x.root]);
    await stubConfirm(app, []);
    await window.getByTestId('add-folder-button').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
    await expect(entryFor(window, x.root)).toHaveCount(1);
    await expect(window.getByTestId('manage-error')).toBeHidden();
    expect(await picker.calls()).toBe(1);
    expect(await confirmCalls(app)).toEqual([]);

    // B shows X's files and Y's; A shows only X's.
    await expect(rowAt(window, x.root)).toBeVisible();
    await expect(rowAt(window, y.root)).toBeVisible();
    await selectCollection(window, 'Alpha');
    await expect(rowAt(window, x.root)).toBeVisible();
    await expect(rowAt(window, y.root)).toHaveCount(0);
    await app.close();

    // Two records for the same path: different ids, different collections, each with an index.
    const inA = folderAt(userDataDir, a.id, x.root);
    const inB = folderAt(userDataDir, b.id, x.root);
    expect(inA).toBeTruthy();
    expect(inB).toBeTruthy();
    expect(inA.folder.path).toBe(inB.folder.path);
    expect(inA.folder.id).not.toBe(inB.folder.id);
    expect(inA.folder.collectionId).toBe(a.id);
    expect(inB.folder.collectionId).toBe(b.id);
    expect(inA.index.length).toBeGreaterThan(0);
    expect(inB.index.length).toBeGreaterThan(0);
    expect(inA.index.every((r) => r.folderId === inA.folder.id && r.collectionId === a.id)).toBe(true);
    expect(inB.index.every((r) => r.folderId === inB.folder.id && r.collectionId === b.id)).toBe(true);
    expect(new Set(openStorage({ location: { baseDir: userDataDir } }).listFolders().map((f) => f.id)).size).toBe(3);
    expect(listing(x.root)).toEqual(diskBefore);

    // A file created on disk; rescanning A updates A only, B keeps the old copy.
    fs.writeFileSync(added, 'created after the scan\n');
    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await selectCollection(window, 'Alpha');
    await rescan(window, 1);
    await rowAt(window, x.root).click();
    await expect(rowAt(window, added)).toBeVisible();
    await selectCollection(window, 'Beta');
    await rowAt(window, x.root).click();
    await expect(rowAt(window, `${x.root}/top.mp3`)).toBeVisible();
    await expect(rowAt(window, added)).toHaveCount(0);
    await app.close();

    const aAfterRescan = folderAt(userDataDir, a.id, x.root);
    expect(hasFile(aAfterRescan, added)).toBe(true);
    expect(hasFile(folderAt(userDataDir, b.id, x.root), added)).toBe(false);
    expect(folderAt(userDataDir, b.id, x.root)).toEqual(inB);
    expect(aAfterRescan.folder.id).toBe(inA.folder.id);

    // Rescanning B brings its copy up to date.
    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await selectCollection(window, 'Beta');
    await rescan(window, 2);
    await rowAt(window, x.root).click();
    await expect(rowAt(window, added)).toBeVisible();
    await app.close();
    expect(hasFile(folderAt(userDataDir, b.id, x.root), added)).toBe(true);

    // Removing X from B leaves A's folder record, index and tree identical.
    const aBeforeRemove = foldersOf(userDataDir, a.id);
    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await selectCollection(window, 'Alpha');
    await rowAt(window, x.root).click();
    const aRows = await window.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path));
    await selectCollection(window, 'Beta');
    await stubConfirm(app, []);
    await entryFor(window, x.root).getByTestId('remove-folder').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(1, { timeout: 30000 });
    await expect(rowAt(window, x.root)).toHaveCount(0);
    await expect(rowAt(window, y.root)).toBeVisible();
    expect(await confirmCalls(app)).toEqual([]);
    await selectCollection(window, 'Alpha');
    await rowAt(window, x.root).click();
    expect(await window.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path))).toEqual(aRows);
    await app.close();
    expect(JSON.stringify(foldersOf(userDataDir, a.id))).toBe(JSON.stringify(aBeforeRemove));
    expect(folderAt(userDataDir, b.id, x.root)).toBeUndefined();
    expect(foldersOf(userDataDir, b.id)).toHaveLength(1);

    // Add X to B again, then delete A: B's folder and files stay, after a relaunch too.
    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await selectCollection(window, 'Beta');
    await stubFolderPicker(app, [x.root]);
    await window.getByTestId('add-folder-button').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
    await selectCollection(window, 'Alpha');
    await stubConfirm(app, [true]);
    await window.getByTestId('delete-collection-button').click();
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 5000 });
    await app.close();

    const storeAfter = openStorage({ location: { baseDir: userDataDir } });
    expect(storeAfter.getCollection(a.id)).toBeFalsy();
    expect(storeAfter.listFolders(a.id)).toEqual([]);
    const bAgain = folderAt(userDataDir, b.id, x.root);
    expect(bAgain).toBeTruthy();
    expect(bAgain.index.length).toBeGreaterThan(0);
    expect(foldersOf(userDataDir, b.id)).toHaveLength(2);

    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
    await selectCollection(window, 'Beta');
    await rowAt(window, x.root).click();
    await expect(rowAt(window, `${x.root}/top.mp3`)).toBeVisible();

    // Nothing in X on disk changed except the one file this test created.
    expect(listing(x.root)).toEqual([...diskBefore, 'added-later.mp3'].sort());
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(x.root);
    cleanupFixtureTree(y.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
