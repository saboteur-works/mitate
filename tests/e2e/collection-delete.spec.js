'use strict';

/*
 * Delete collection in the management panel e2e (Feature 3, Task 21; FR-2, FR-4, FR-13).
 * Collections are written to <userDataDir>/store.json before launch with the real service +
 * scanner; the store is read from disk after the app is closed. The confirmation is asked in the
 * main process and stubbed with stubConfirm (default Cancel). Deleting the active collection
 * clears the tree, the selection and the panel; no file on disk changes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, rowAt, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const rowPaths = (window) =>
  window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path),
  );

const listing = (root) => fs.readdirSync(root, { recursive: true }).sort();
const storeBytes = (dir) => fs.readFileSync(path.join(dir, 'store.json'));

const itemNamed = (window, name) =>
  window.getByTestId('collection-item').filter({
    has: window.getByTestId('collection-name-label').getByText(name, { exact: true }),
  });

// What the store holds for one collection: its record, folders and index.
function recordsOf(userDataDir, collectionId) {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  return JSON.parse(JSON.stringify({
    collection: storage.getCollection(collectionId),
    folders: storage.listFolders(collectionId),
    index: storage.getIndex({ collectionId }),
  }));
}

const record = (window) =>
  window.evaluate(() => {
    window.__selEvents = [];
    document.addEventListener('collection-selected', (e) => window.__selEvents.push(e.detail.collectionId));
  });

const selEvents = (window) => window.evaluate(() => window.__selEvents);

async function expectNothingSelected(window) {
  await expect(window.locator('[data-testid="tree-row"][aria-selected="true"]')).toHaveCount(0);
  await expect(window.getByTestId('file-path')).toHaveClass(/file-path-empty/);
  await expect(window.getByTestId('reveal')).toBeDisabled();
}

async function selectTopFile(window, root) {
  await rowAt(window, root).click();
  await rowAt(window, `${root}/top.mp3`).click();
  await expect(rowAt(window, `${root}/top.mp3`)).toHaveAttribute('aria-selected', 'true');
}

test('cancel changes nothing; confirm removes the active collection and clears tree, selection and panel', async () => {
  const userDataDir = newUserDataDir('collection-delete-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    const { collection: alpha } = await service.createCollection('Alpha', [first.root]);
    const { collection: beta } = await service.createCollection('Beta', [second.root]);
    const diskBefore = [listing(first.root), listing(second.root)];

    session = await launchApp(userDataDir);
    let { app, window } = session;
    const byId = (id) => window.getByTestId(id);

    // Nothing is active at launch.
    await expect(byId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await expect(byId('manage-panel')).toBeHidden();
    await expect(byId('tree-row')).toHaveCount(0);

    await itemNamed(window, 'Alpha').click();
    await expect(byId('tree-row').first()).toBeVisible({ timeout: 30000 });
    await selectTopFile(window, first.root);
    const rowsBefore = await rowPaths(window);
    await expect(byId('delete-collection-button')).toBeEnabled();

    // Cancel (the default): one confirmation, everything stays.
    await stubConfirm(app, [false]);
    await byId('delete-collection-button').click();
    await expect.poll(async () => (await confirmCalls(app)).length).toBe(1);
    const [dialog] = await confirmCalls(app);
    expect(JSON.stringify(dialog)).toContain('Alpha');
    expect(JSON.stringify(dialog).toLowerCase()).toContain('no files on disk');
    await expect(byId('delete-collection-button')).toBeEnabled();
    await expect(byId('collection-item')).toHaveCount(2);
    await expect(itemNamed(window, 'Alpha')).toHaveClass(/collection-selected/);
    await expect(byId('manage-panel')).toBeVisible();
    await expect(byId('manage-error')).toBeHidden();
    expect(await rowPaths(window)).toEqual(rowsBefore);
    await expect(rowAt(window, `${first.root}/top.mp3`)).toHaveAttribute('aria-selected', 'true');
    await expect(byId('reveal')).toBeEnabled();

    // Confirm: the item leaves the list at once and the page is cleared.
    await record(window);
    await stubConfirm(app, [true]);
    await byId('delete-collection-button').click();
    await expect(byId('collection-item')).toHaveCount(1, { timeout: 2000 });
    await expect(itemNamed(window, 'Alpha')).toHaveCount(0);
    await expect(byId('tree-row')).toHaveCount(0);
    await expectNothingSelected(window);
    await expect(byId('rescan')).toBeDisabled();
    await expect(byId('manage-panel')).toBeHidden();
    await expect(window.locator('.collection-selected')).toHaveCount(0);
    expect(await selEvents(window)).toEqual([null]);
    expect((await confirmCalls(app)).length).toBe(2);

    // The remaining collection can still be chosen.
    await itemNamed(window, 'Beta').click();
    await expect(rowAt(window, second.root)).toBeVisible({ timeout: 30000 });

    await app.close();
    const stored = openStorage({ location: { baseDir: userDataDir } });
    expect(stored.getCollection(alpha.id)).toBeFalsy();
    expect(stored.listFolders(alpha.id)).toEqual([]);
    expect(stored.getIndex({ collectionId: alpha.id })).toEqual([]);
    expect(stored.getCollection(beta.id)).toBeTruthy();
    expect(listing(first.root)).toEqual(diskBefore[0]);
    expect(listing(second.root)).toEqual(diskBefore[1]);

    // Relaunch: only Beta is listed and nothing is active.
    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
    await expect(itemNamed(window, 'Beta')).toHaveCount(1);
    await expect(window.getByTestId('manage-panel')).toBeHidden();
    await expect(window.getByTestId('tree-row')).toHaveCount(0);
    
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(first.root);
    cleanupFixtureTree(second.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a cancelled delete leaves store.json byte-identical', async () => {
  const userDataDir = newUserDataDir('collection-delete-cancel-e2e');
  const only = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Solo', [only.root]);
    const bytesBefore = storeBytes(userDataDir);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
    await window.getByTestId('collection-item').click();
    await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
    await stubConfirm(app, [false]);
    await window.getByTestId('delete-collection-button').click();
    await expect.poll(async () => (await confirmCalls(app)).length).toBe(1);
    await expect(window.getByTestId('collection-item')).toHaveCount(1);
    await app.close();
    expect(storeBytes(userDataDir).equals(bytesBefore)).toBe(true);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(only.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('two collections sharing a folder: deleting one leaves the other intact', async () => {
  const userDataDir = newUserDataDir('collection-delete-shared-e2e');
  const shared = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    const { collection: one } = await service.createCollection('One', [shared.root]);
    const { collection: two } = await service.createCollection('Two', [shared.root]);
    const twoBefore = recordsOf(userDataDir, two.id);
    const diskBefore = listing(shared.root);

    session = await launchApp(userDataDir);
    let { app, window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });

    // The other collection's tree, as shown before the delete.
    await itemNamed(window, 'Two').click();
    await expect(rowAt(window, shared.root)).toBeVisible({ timeout: 30000 });
    await rowAt(window, shared.root).click();
    const twoRows = await rowPaths(window);

    await itemNamed(window, 'One').click();
    await expect(window.getByTestId('manage-panel')).toBeVisible();
    await expect(window.getByTestId('rename-input')).toHaveValue('One');
    await stubConfirm(app, [true]);
    await window.getByTestId('delete-collection-button').click();
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 2000 });
    await expect(window.getByTestId('tree-row')).toHaveCount(0);

    await itemNamed(window, 'Two').click();
    await expect(rowAt(window, shared.root)).toBeVisible({ timeout: 30000 });
    await rowAt(window, shared.root).click();
    expect(await rowPaths(window)).toEqual(twoRows);

    await app.close();
    expect(recordsOf(userDataDir, two.id)).toEqual(twoBefore);
    expect(openStorage({ location: { baseDir: userDataDir } }).getCollection(one.id)).toBeFalsy();
    expect(listing(shared.root)).toEqual(diskBefore);

    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
    await window.getByTestId('collection-item').click();
    await expect(rowAt(window, shared.root)).toBeVisible({ timeout: 30000 });
    expect((await rowPaths(window)).length).toBeGreaterThan(0);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(shared.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('deleting a collection that is not the active one leaves the shown tree and selection', async () => {
  const userDataDir = newUserDataDir('collection-delete-other-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    await service.createCollection('Shown', [first.root]);
    const { collection: other } = await service.createCollection('Other', [second.root]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await itemNamed(window, 'Shown').click();
    await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
    await selectTopFile(window, first.root);
    const rowsBefore = await rowPaths(window);
    await record(window);

    // The panel only manages the shown collection, so the other one is deleted through the
    // channel; the list refreshes as it does after a panel action.
    await stubConfirm(app, [true]);
    const result = await window.evaluate((id) => window.mediaOrganizer.deleteCollection(id), other.id);
    expect(result).toEqual({ ok: true, deleted: true });
    await window.evaluate(() => document.dispatchEvent(new CustomEvent('collections-changed')));
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 2000 });
    await expect(itemNamed(window, 'Shown')).toHaveClass(/collection-selected/);
    expect(await rowPaths(window)).toEqual(rowsBefore);
    await expect(rowAt(window, `${first.root}/top.mp3`)).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('manage-panel')).toBeVisible();
    await expect(window.getByTestId('rescan')).toBeEnabled();
    expect(await selEvents(window)).toEqual([]);
    expect((await confirmCalls(app)).length).toBe(1);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(first.root);
    cleanupFixtureTree(second.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
