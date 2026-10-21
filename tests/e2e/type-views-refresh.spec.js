'use strict';

/*
 * Refresh of the type lists and view switching e2e (Feature 4, Task 15; FR-9, FR-11, FR-13).
 * type-views-wiring.spec.js already covers that each data change rebuilds the open list at once
 * and the others on their next open, and that the tree keeps its expansion and scroll across a
 * view switch. This spec adds the comparison of the lists with the tree by absolute path after
 * each action (rescan with files added and deleted, add folder, remove folder, replace on
 * contains), and that switching views scans nothing, writes nothing and is not remembered.
 * Collections are written to <userDataDir>/store.json before launch with the real scanner.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, stubFolderPicker, stubConfirm, confirmCalls, gateChannel,
} = require('../support/e2e-app.js');
const { CHANNELS } = require('../../src/main/ipc.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { KINDS, listRows, openList, seedCollection, selectCollection } = require('../support/type-views-ui.js');

async function expandRendered(window) {
  const collapsed = window.locator('[data-testid="tree-row"][data-type="folder"][data-expanded="false"]');
  while ((await collapsed.count()) > 0) await collapsed.first().click();
}

const treeFilePaths = async (window) =>
  (await window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"][data-type="file"]')].map((r) => r.dataset.path),
  )).sort();

// Reads a list after its tab was opened; returns its absolute paths in list order.
async function readList(window, kind) {
  await window.getByTestId(`view-tab-${kind}`).click();
  await expect(window.getByTestId('list-loading')).toHaveCount(0);
  return (await listRows(window)).map((r) => r.path);
}

// The four lists together hold exactly the files the tree shows, each once, by absolute path.
// Ends on the Tree tab. The collections here are small enough for the tree to render in full.
async function expectListsMatchTree(window) {
  const listed = [];
  for (const kind of KINDS) listed.push(...(await readList(window, kind)));
  expect(new Set(listed).size).toBe(listed.length);
  await window.getByTestId('view-tab-tree').click();
  await expandRendered(window);
  expect(await treeFilePaths(window)).toEqual(listed.sort());
}

const folderPaths = (window) => window.getByTestId('manage-folder-path').allTextContents();

test('after rescan, add folder, remove folder and replace on contains the lists hold the files the tree shows', async () => {
  const userDataDir = newUserDataDir('type-refresh-e2e');
  const a = buildFixtureTree();
  const c = buildFixtureTree();
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-type-refresh-'));
  let session;
  try {
    for (const name of ['b1.jpg', 'b2.png', 'jingle.wav']) fs.writeFileSync(path.join(extra, name), 'x\n');
    await seedCollection(userDataDir, 'Work', [a.root]);
    await seedCollection(userDataDir, 'Inner', [`${c.root}/Photos`]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await selectCollection(window, 'Work');

    // Rescan with Audio open: a file added on disk appears, one deleted disappears.
    const added = `${a.root}/Music/new.mp3`;
    await openList(window, 'audio', 2);
    fs.writeFileSync(added, 'new\n');
    fs.rmSync(`${a.root}/top.mp3`);
    await window.getByTestId('rescan').click();
    await expect(window.getByTestId('rescan-status')).toHaveText(/^Rescanned/, { timeout: 30000 });
    await expect(window.getByTestId('rescan')).toBeEnabled();
    expect((await listRows(window)).map((r) => r.path)).toEqual([added, `${a.root}/Music/Album/track01.flac`]);
    await expectListsMatchTree(window);

    // Add folder with Images open: its images join the list.
    const imagePaths = (root) => ['A.JPG', '2024/b.png', '2024/Trip/c.heic', '2024/Trip/Day1/deep.jpg'].map((r) => `${root}/Photos/${r}`);
    await openList(window, 'image', 4);
    await stubFolderPicker(app, [extra]);
    await window.getByTestId('add-folder-button').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
    await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });
    await expect(window.getByTestId('list-row')).toHaveCount(6);
    expect((await listRows(window)).map((r) => r.path).sort()).toEqual([...imagePaths(a.root), `${extra}/b1.jpg`, `${extra}/b2.png`].sort());
    await expectListsMatchTree(window);

    // Remove that folder with Images open: its images leave the list.
    await openList(window, 'image', 6);
    await window.getByTestId('manage-folder').nth(1).getByTestId('remove-folder').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(1, { timeout: 30000 });
    await expect(window.getByTestId('list-row')).toHaveCount(4);
    expect((await listRows(window)).map((r) => r.path).sort()).toEqual(imagePaths(a.root).sort());
    await expectListsMatchTree(window);

    // Replace on contains: the collection holds a subfolder, its parent is added, confirmed.
    await selectCollection(window, 'Inner');
    await openList(window, 'image', 4);
    await expect.poll(() => folderPaths(window)).toEqual([`${c.root}/Photos`]);
    await stubFolderPicker(app, [c.root]);
    await stubConfirm(app, [true]);
    await window.getByTestId('add-folder-button').click();
    await expect.poll(() => folderPaths(window), { timeout: 30000 }).toEqual([c.root]);
    await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });
    expect(await confirmCalls(app)).toHaveLength(1);
    await expect(window.getByTestId('list-row')).toHaveCount(4);
    const innerImages = (await listRows(window)).map((r) => r.path);
    expect(new Set(innerImages).size).toBe(4);
    expect(innerImages.sort()).toEqual(imagePaths(c.root).sort());
    // The files that were outside the subfolder are listed now, once each.
    expect(await readList(window, 'audio')).toEqual([`${c.root}/top.mp3`, `${c.root}/Music/Album/track01.flac`]);
    await expectListsMatchTree(window);
  } finally {
    if (session) await session.app.close().catch(() => {});
    for (const f of [a, c]) cleanupFixtureTree(f.root);
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('switching views five times scans nothing and writes nothing; the last view is not remembered', async () => {
  const userDataDir = newUserDataDir('type-switch-e2e');
  const fixture = buildFixtureTree();
  let session;
  try {
    await seedCollection(userDataDir, 'Switch', [fixture.root]);
    const storePath = `${userDataDir}/store.json`;

    session = await launchApp(userDataDir);
    let { app, window } = session;
    const gate = await gateChannel(app, CHANNELS.rescanCollection);
    await selectCollection(window, 'Switch');

    // The app is idle: take the store as it is, switch five times, take it again.
    const bytes = fs.readFileSync(storePath);
    const mtime = fs.statSync(storePath).mtimeMs;
    for (const view of ['image', 'audio', 'video', 'document', 'tree']) {
      await window.getByTestId(`view-tab-${view}`).click();
      await expect(window.getByTestId(`view-tab-${view}`)).toHaveAttribute('aria-selected', 'true');
      await expect(window.getByTestId('list-loading')).toHaveCount(0);
    }
    await expect(window.getByTestId('tree-view')).toBeVisible();
    expect(await gate.calls()).toBe(0);
    expect(fs.readFileSync(storePath).equals(bytes)).toBe(true);
    expect(fs.statSync(storePath).mtimeMs).toBe(mtime);

    // Leave on a list view and quit.
    await window.getByTestId('view-tab-document').click();
    await expect(window.getByTestId('list-row').first()).toBeVisible();
    await app.close();
    session = null;
    expect(fs.readFileSync(storePath).equals(bytes)).toBe(true);

    // Relaunch: Tree is active, no collection is selected, and the app works.
    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
    await expect(window.getByTestId('view-tab-tree')).toHaveAttribute('aria-selected', 'true');
    await expect(window.locator('[data-testid="collection-item"].collection-selected')).toHaveCount(0);
    await expect(window.getByTestId('tree-row')).toHaveCount(0);
    await expect(window.getByTestId('list-row')).toHaveCount(0);
    for (const view of ['tree', 'image', 'audio', 'video', 'document']) {
      await expect(window.getByTestId(`view-tab-${view}`)).toBeDisabled();
    }
    await selectCollection(window, 'Switch');
    await openList(window, 'image', 4);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(fixture.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
