'use strict';

/*
 * Add folder in the management panel e2e (Feature 3, Task 19; FR-7, FR-13). The collection is
 * written to <userDataDir>/store.json before launch with the real service + scanner. The picker is
 * stubbed (stubFolderPicker) and the confirmation stub answers Cancel unless told otherwise, so no
 * native dialog opens. The store is read from disk after the app is closed.
 */

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, rowAt, selectOnlyCollection, stubFolderPicker, gateChannel, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree, lockFolder, unlockFolder } = require('../support/fixture-tree.js');
const { CHANNELS } = require('../../src/main/ipc.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const topOf = (root) => `${root}/top.mp3`;

const storeFile = (userDataDir) => `${userDataDir}/store.json`;

// What the store holds for one folder: its record and its index records.
function folderState(userDataDir, collectionId, folderPath) {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  const folder = storage.listFolders(collectionId).find((f) => f.path === folderPath);
  return folder ? { folder, index: storage.getIndex({ folderId: folder.id }) } : null;
}

const storedPaths = (userDataDir, collectionId) =>
  openStorage({ location: { baseDir: userDataDir } }).listFolders(collectionId).map((f) => f.path);

async function createCollection(userDataDir, name, roots) {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  const created = await createCollectionService({ storage }).createCollection(name, roots);
  return created.collection.id;
}

test('add a second folder: directory-only picker, no prompt, only the new folder scanned, persisted', async () => {
  const userDataDir = newUserDataDir('folder-add-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  let session;
  try {
    const collectionId = await createCollection(userDataDir, 'Solo', [first.root]);
    const firstBefore = folderState(userDataDir, collectionId, first.root);
    expect(firstBefore.index.length).toBeGreaterThan(0);

    session = await launchApp(userDataDir);
    let { app, window } = session;
    await selectOnlyCollection(window);
    await expect(window.getByTestId('manage-folder')).toHaveCount(1);

    const picker = await stubFolderPicker(app, [second.root]);
    const rescan = await gateChannel(app, CHANNELS.rescanCollection);
    await stubConfirm(app, []);

    await window.getByTestId('add-folder-button').click();

    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
    await expect(window.getByTestId('manage-folder-path').nth(1)).toHaveText(second.root);
    await expect(rowAt(window, second.root)).toBeVisible();
    await rowAt(window, second.root).click();
    await expect(rowAt(window, topOf(second.root))).toBeVisible();
    await expect(window.getByTestId('manage-error')).toBeHidden();
    await expect(window.getByTestId('collection-item')).toContainText('(2 folders)');

    expect(await picker.calls()).toBe(1);
    const properties = (await picker.lastOptions()).properties;
    expect(properties).toContain('openDirectory');
    expect(properties).not.toContain('openFile');
    expect(await confirmCalls(app)).toEqual([]);
    expect(await rescan.calls()).toBe(0);

    await app.close();
    const firstAfter = folderState(userDataDir, collectionId, first.root);
    expect(JSON.stringify(firstAfter)).toBe(JSON.stringify(firstBefore));
    expect(storedPaths(userDataDir, collectionId)).toEqual([first.root, second.root]);
    expect(folderState(userDataDir, collectionId, second.root).index.length).toBeGreaterThan(0);

    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await selectOnlyCollection(window);
    await expect(window.getByTestId('manage-folder')).toHaveCount(2);
    await expect(window.getByTestId('manage-folder-path').nth(1)).toHaveText(second.root);
    await expect(rowAt(window, second.root)).toBeVisible();
    await rowAt(window, second.root).click();
    await expect(rowAt(window, topOf(second.root))).toBeVisible();
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(first.root);
    cleanupFixtureTree(second.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('two folders picked at once are added in pick order; the selected collection and file stay selected', async () => {
  const userDataDir = newUserDataDir('folder-add-two-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  const third = buildFixtureTree();
  let session;
  try {
    const collectionId = await createCollection(userDataDir, 'Grow', [first.root]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    await rowAt(window, first.root).click();
    await rowAt(window, topOf(first.root)).click();
    await expect(rowAt(window, topOf(first.root))).toHaveAttribute('aria-selected', 'true');

    await stubFolderPicker(app, [third.root, second.root]);
    await window.getByTestId('add-folder-button').click();

    await expect(window.getByTestId('manage-folder')).toHaveCount(3, { timeout: 30000 });
    await expect(window.getByTestId('manage-folder-path')).toHaveText([first.root, third.root, second.root]);
    await expect(rowAt(window, third.root)).toBeVisible();
    await expect(rowAt(window, second.root)).toBeVisible();

    await expect(window.getByTestId('collection-item')).toHaveClass(/collection-selected/);
    await expect(rowAt(window, topOf(first.root))).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('file-path')).toHaveText(topOf(first.root));
    await expect(rowAt(window, first.root)).toHaveAttribute('data-expanded', 'true');
    expect(await confirmCalls(app)).toEqual([]);

    await app.close();
    expect(storedPaths(userDataDir, collectionId)).toEqual([first.root, third.root, second.root]);
  } finally {
    if (session) await session.app.close().catch(() => {});
    for (const f of [first, second, third]) cleanupFixtureTree(f.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a folder that cannot be opened for listing is refused with an error naming it; nothing changes', async () => {
  test.skip(typeof process.getuid === 'function' && process.getuid() === 0, 'running as root: chmod 000 does not stop root from listing a folder');
  const userDataDir = newUserDataDir('folder-add-locked-e2e');
  const first = buildFixtureTree();
  const copy = buildFixtureTree();
  const locked = `${copy.root}/Docs`;
  let session;
  try {
    const collectionId = await createCollection(userDataDir, 'Locked', [first.root]);
    const storeBefore = fs.readFileSync(storeFile(userDataDir), 'utf8');

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    const rowsBefore = await window.getByTestId('tree-row').count();

    lockFolder(locked);
    await stubFolderPicker(app, [locked]);
    await stubConfirm(app, [true]);
    await window.getByTestId('add-folder-button').click();

    await expect(window.getByTestId('manage-error')).toBeVisible({ timeout: 30000 });
    await expect(window.getByTestId('manage-error')).toContainText(locked);
    await expect(window.getByTestId('manage-folder')).toHaveCount(1);
    await expect(window.getByTestId('tree-row')).toHaveCount(rowsBefore);
    await expect(rowAt(window, locked)).toHaveCount(0);
    expect(await confirmCalls(app)).toEqual([]);

    await app.close();
    expect(fs.readFileSync(storeFile(userDataDir), 'utf8')).toBe(storeBefore);
    expect(storedPaths(userDataDir, collectionId)).toEqual([first.root]);
  } finally {
    if (session) await session.app.close().catch(() => {});
    try { unlockFolder(locked); } catch { /* the fixture may already be gone */ }
    cleanupFixtureTree(first.root);
    cleanupFixtureTree(copy.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a confirmed replace shows manage-notice naming the replaced folder; the next action clears it', async () => {
  const userDataDir = newUserDataDir('folder-add-replace-notice-e2e');
  const fx = buildFixtureTree();
  const inner = `${fx.root}/Photos`;
  let session;
  try {
    const collectionId = await createCollection(userDataDir, 'Replace', [inner]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    await expect(window.getByTestId('manage-notice')).toBeHidden();

    await stubFolderPicker(app, [fx.root]);
    await stubConfirm(app, [true]);
    await window.getByTestId('add-folder-button').click();

    await expect(window.getByTestId('manage-notice')).toBeVisible({ timeout: 30000 });
    await expect(window.getByTestId('manage-notice')).toContainText(inner);
    await expect(window.getByTestId('manage-notice')).toHaveAttribute('role', 'status');
    await expect(window.getByTestId('manage-folder-path')).toHaveText([fx.root]);
    await expect(rowAt(window, fx.root)).toBeVisible();
    await expect(rowAt(window, inner)).toHaveCount(0);
    await expect(window.getByTestId('manage-error')).toBeHidden();
    expect(await confirmCalls(app)).toHaveLength(1);

    // The next action in the panel clears the notice.
    await window.getByTestId('rename-button').click();
    await expect(window.getByTestId('manage-notice')).toBeHidden();

    await app.close();
    expect(storedPaths(userDataDir, collectionId)).toEqual([fx.root]);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(fx.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a subfolder of an existing folder is refused with "already covered"; nothing changes and nothing is asked', async () => {
  const userDataDir = newUserDataDir('folder-add-refused-e2e');
  const fx = buildFixtureTree();
  let session;
  try {
    const collectionId = await createCollection(userDataDir, 'Refuse', [fx.root]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    const rowsBefore = await window.getByTestId('tree-row').count();

    await stubFolderPicker(app, [`${fx.root}/Photos`]);
    await stubConfirm(app, [true]);
    await window.getByTestId('add-folder-button').click();

    const error = window.getByTestId('manage-error');
    await expect(error).toBeVisible({ timeout: 30000 });
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error).toContainText('already covered');
    await expect(error).toContainText(fx.root);
    await expect(window.getByTestId('manage-notice')).toBeHidden();
    await expect(window.getByTestId('manage-folder-path')).toHaveText([fx.root]);
    await expect(window.getByTestId('tree-row')).toHaveCount(rowsBefore);
    expect(await confirmCalls(app)).toEqual([]);

    await app.close();
    expect(storedPaths(userDataDir, collectionId)).toEqual([fx.root]);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(fx.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('when one pick of three is refused the rest are not added and the earlier pick stays', async () => {
  const userDataDir = newUserDataDir('folder-add-refused-multi-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  const third = buildFixtureTree();
  let session;
  try {
    const collectionId = await createCollection(userDataDir, 'Stop', [first.root]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);

    await stubFolderPicker(app, [second.root, `${first.root}/Photos`, third.root]);
    await window.getByTestId('add-folder-button').click();

    await expect(window.getByTestId('manage-error')).toContainText('already covered', { timeout: 30000 });
    await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });
    await expect(window.getByTestId('manage-folder-path')).toHaveText([first.root, second.root]);
    expect(await confirmCalls(app)).toEqual([]);

    await app.close();
    expect(storedPaths(userDataDir, collectionId)).toEqual([first.root, second.root]);
  } finally {
    if (session) await session.app.close().catch(() => {});
    for (const f of [first, second, third]) cleanupFixtureTree(f.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a folder and its subfolder picked together add one folder; the subfolder is named in the notice', async () => {
  const userDataDir = newUserDataDir('folder-add-nested-picks-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  const nested = `${second.root}/Photos`;
  let session;
  try {
    const collectionId = await createCollection(userDataDir, 'Nested', [first.root]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);

    await stubFolderPicker(app, [second.root, nested]);
    await stubConfirm(app, [true]);
    await window.getByTestId('add-folder-button').click();

    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
    await expect(window.getByTestId('manage-folder-path')).toHaveText([first.root, second.root]);
    await expect(window.getByTestId('manage-notice')).toBeVisible();
    await expect(window.getByTestId('manage-notice')).toContainText(nested);
    await expect(window.getByTestId('manage-error')).toBeHidden();
    expect(await confirmCalls(app)).toEqual([]);

    await app.close();
    expect(storedPaths(userDataDir, collectionId)).toEqual([first.root, second.root]);
  } finally {
    if (session) await session.app.close().catch(() => {});
    for (const f of [first, second]) cleanupFixtureTree(f.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
