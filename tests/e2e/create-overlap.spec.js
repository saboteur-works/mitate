'use strict';

/*
 * Nested picks at creation e2e (Feature 3, Tasks 22 and 36; FR-8 revised 2026-10-21 creation case,
 * FR-6, FR-13). Picks that lie inside another pick are dropped, whatever the pick order: the
 * collection is created with the outer folders only, create-notice names each dropped pick and its
 * cover, and no dialog is asked (confirmCalls stays empty). The folder picker (stubFolderPicker)
 * and the confirmation (stubConfirm, recorded by confirmCalls) are stubbed in the main process, so
 * no native dialog opens. The store is read from disk after the app is closed.
 */

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, stubFolderPicker, gateChannel, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { CHANNELS } = require('../../src/main/ipc.js');
const { openStorage } = require('../../src/main/storage/index.js');

async function withApp(label, body) {
  const userDataDir = newUserDataDir(label);
  const tree = buildFixtureTree();
  const session = await launchApp(userDataDir);
  try {
    await body({ ...session, tree, userDataDir });
  } finally {
    await session.app.close().catch(() => {});
    cleanupFixtureTree(tree.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function pickAndName(window, name) {
  await window.getByTestId('add-folder').click();
  await window.getByTestId('collection-name').fill(name);
}

const stateOf = (userDataDir) => {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  const [collection] = storage.listCollections();
  const folders = storage.listFolders(collection.id);
  return { storage, collection, folders, index: storage.getIndex({ collectionId: collection.id }) };
};

for (const order of ['outer first', 'inner first']) {
  test(`nested picks (${order}): the inner pick is dropped with a notice, no confirmation, nothing stored for it`, async () => {
    await withApp('create-nested', async ({ app, window, tree, userDataDir }) => {
      const inner = `${tree.root}/Photos`;
      const picks = order === 'outer first' ? [tree.root, inner] : [inner, tree.root];
      await stubFolderPicker(app, picks);
      await stubConfirm(app, []);
      const rescan = await gateChannel(app, CHANNELS.rescanCollection);
      const byId = (id) => window.getByTestId(id);

      await pickAndName(window, 'Nested');
      await expect(byId('folder-item')).toHaveCount(2);
      await byId('create-collection').click();
      await expect(byId('collection-item')).toHaveCount(1, { timeout: 30000 });
      await expect(byId('collection-folder-count')).toHaveText('1');
      await expect(byId('create-notice')).toBeVisible();
      await expect(byId('create-notice')).toContainText(inner);
      await expect(byId('create-notice')).toContainText(tree.root);
      await expect(byId('create-error')).toBeHidden();
      await expect(byId('folder-item')).toHaveCount(0);
      await expect(byId('collection-name')).toHaveValue('');
      expect(await confirmCalls(app)).toEqual([]);
      expect(await rescan.calls()).toBe(0);

      // The tree shows only the outer root, and each file once.
      await byId('collection-item').click();
      await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
      const rows = await window.evaluate(() =>
        [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path));
      expect(rows).toEqual([tree.root]);
      await window.getByTestId('tree-row').first().click();
      const paths = await window.evaluate(() =>
        [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path));
      expect(new Set(paths).size).toBe(paths.length);
      expect(paths).toContain(inner);

      await app.close();
      const { folders, index, storage } = stateOf(userDataDir);
      expect(folders.map((f) => f.path)).toEqual([tree.root]);
      expect(index.length).toBeGreaterThan(0);
      expect(index.every((r) => r.folderId === folders[0].id)).toBe(true);
      expect(storage.listFolders().some((f) => f.path === inner)).toBe(false);

      // Nothing is stored for the dropped folder after a relaunch either.
      const again = await launchApp(userDataDir);
      try {
        await expect(again.window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
        await again.window.getByTestId('collection-item').click();
        await expect(again.window.getByTestId('manage-folder-path')).toHaveText([tree.root], { timeout: 30000 });
        await expect(again.window.locator(`[data-testid="tree-row"][data-path="${inner}"]`)).toHaveCount(0);
      } finally {
        await again.app.close().catch(() => {});
      }
      expect(stateOf(userDataDir).folders.map((f) => f.path)).toEqual([tree.root]);
    });
  });
}

test('unrelated picks create all their folders with no notice and no confirmation', async () => {
  await withApp('create-unrelated', async ({ app, window, tree, userDataDir }) => {
    const other = buildFixtureTree();
    try {
      await stubFolderPicker(app, [tree.root, other.root]);
      await stubConfirm(app, []);
      await pickAndName(window, 'Unrelated');
      await window.getByTestId('create-collection').click();
      await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
      await expect(window.getByTestId('collection-folder-count')).toHaveText('2');
      await expect(window.getByTestId('create-notice')).toBeHidden();
      expect(await confirmCalls(app)).toEqual([]);
      await app.close();
      expect(stateOf(userDataDir).folders.map((f) => f.path)).toEqual([tree.root, other.root]);
    } finally {
      cleanupFixtureTree(other.root);
    }
  });
});

test('the same folder created into two collections is accepted with no confirmation', async () => {
  await withApp('create-overlap-twice', async ({ app, window, tree, userDataDir }) => {
    await stubFolderPicker(app, [tree.root]);
    const byId = (id) => window.getByTestId(id);
    for (const [i, name] of ['First', 'Second'].entries()) {
      await pickAndName(window, name);
      await byId('create-collection').click();
      await expect(byId('collection-item')).toHaveCount(i + 1, { timeout: 30000 });
    }
    await expect(byId('collection-name-label')).toHaveText(['First', 'Second']);
    await expect(byId('create-error')).toBeHidden();
    await expect(byId('create-notice')).toBeHidden();
    expect(await confirmCalls(app)).toEqual([]);
    await app.close();
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const collections = storage.listCollections();
    expect(collections).toHaveLength(2);
    for (const c of collections) expect(storage.listFolders(c.id).map((f) => f.path)).toEqual([tree.root]);
  });
});
