'use strict';

/*
 * Overlap confirmation at creation e2e (Feature 3, Task 22; FR-8 creation case, FR-6). The
 * folder picker (stubFolderPicker) and the confirmation (stubConfirm, recorded by confirmCalls) are
 * stubbed in the main process, so no native dialog opens. The overlap check and the dialog text
 * come from the real service. The store is read from disk after the app is closed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, stubFolderPicker, gateChannel, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { CHANNELS } = require('../../src/main/ipc.js');
const { openStorage } = require('../../src/main/storage/index.js');

const storeFile = (userDataDir) => path.join(userDataDir, 'store.json');
const readStore = (userDataDir) =>
  (fs.existsSync(storeFile(userDataDir)) ? fs.readFileSync(storeFile(userDataDir), 'utf8') : null);
const indexSize = (userDataDir) => openStorage({ location: { baseDir: userDataDir } }).getIndex().length;

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

test('overlapping picks: one confirmation names the overlap; cancel keeps the form, confirm creates', async () => {
  await withApp('create-overlap', async ({ app, window, tree, userDataDir }) => {
    const inner = `${tree.root}/Photos`;
    await stubFolderPicker(app, [tree.root, inner]);
    const rescan = await gateChannel(app, CHANNELS.rescanCollection);
    const byId = (id) => window.getByTestId(id);

    await pickAndName(window, 'Overlap');
    await expect(byId('folder-item')).toHaveCount(2);

    // Cancel (the default answer): the form stays as it was, nothing is created, no error.
    await stubConfirm(app, [false]);
    await byId('create-collection').click();
    await expect.poll(async () => (await confirmCalls(app)).length, { timeout: 30000 }).toBe(1);
    await expect(byId('create-collection')).toBeEnabled({ timeout: 30000 });
    const call = JSON.stringify((await confirmCalls(app))[0]);
    expect(call).toContain('already covered');
    expect(call).toContain(tree.root);
    await expect(byId('collection-name')).toHaveValue('Overlap');
    await expect(byId('folder-item')).toHaveText([tree.root, inner]);
    await expect(byId('collection-item')).toHaveCount(0);
    await expect(byId('create-error')).toBeHidden();
    const listed = await window.evaluate(() => window.mediaOrganizer.listCollections());
    expect(listed.summaries).toHaveLength(0);
    expect(await rescan.calls()).toBe(0);

    // Create again with the same form and confirm: both folders, form cleared.
    await stubConfirm(app, [true]);
    await byId('create-collection').click();
    await expect(byId('collection-item')).toHaveCount(1, { timeout: 30000 });
    await expect(byId('collection-folder-count')).toHaveText('2');
    await expect(byId('folder-item')).toHaveCount(0);
    await expect(byId('collection-name')).toHaveValue('');
    await expect(byId('create-error')).toBeHidden();
    expect(await confirmCalls(app)).toHaveLength(2);

    await app.close();
    const folders = openStorage({ location: { baseDir: userDataDir } });
    const [collection] = folders.listCollections();
    expect(folders.listFolders(collection.id).map((f) => f.path)).toEqual([tree.root, inner]);
  });
});

test('cancel leaves the store and index exactly as they were', async () => {
  await withApp('create-overlap-cancel', async ({ app, window, tree, userDataDir }) => {
    await stubFolderPicker(app, [tree.root, `${tree.root}/Photos`]);
    await stubConfirm(app, [false]);
    const storeBefore = readStore(userDataDir);
    await pickAndName(window, 'Never');
    await window.getByTestId('create-collection').click();
    await expect.poll(async () => (await confirmCalls(app)).length, { timeout: 30000 }).toBe(1);
    await expect(window.getByTestId('create-collection')).toBeEnabled({ timeout: 30000 });
    await app.close();
    expect(readStore(userDataDir)).toBe(storeBefore);
    expect(indexSize(userDataDir)).toBe(0);
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
    expect(await confirmCalls(app)).toEqual([]);
    await app.close();
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const collections = storage.listCollections();
    expect(collections).toHaveLength(2);
    for (const c of collections) expect(storage.listFolders(c.id).map((f) => f.path)).toEqual([tree.root]);
  });
});
