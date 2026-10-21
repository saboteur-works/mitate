'use strict';

/*
 * Add folder that contains existing folders: replace e2e (Feature 3, Task 35; FR-8 revised
 * 2026-10-21, FR-3, FR-4, FR-9, FR-13). Adding a parent of folders already in the collection asks
 * once ("Replace folders"); on confirm the new folder is scanned and one transaction replaces the
 * contained folders (their records, index entries and access data go), on cancel nothing changes.
 * Collections are written to <userDataDir>/store.json before launch with the real service +
 * scanner. The picker (stubFolderPicker) and the confirmation (stubConfirm, recorded by
 * confirmCalls) are stubbed in the main process, so no native dialog opens. The store is read from
 * disk after the app is closed. Every case runs on its own copy of the fixture tree.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, rowAt, stubFolderPicker, gateChannel, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { CHANNELS } = require('../../src/main/ipc.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const storeOf = (userDataDir) => openStorage({ location: { baseDir: userDataDir } });
const readStore = (userDataDir) => fs.readFileSync(path.join(userDataDir, 'store.json'), 'utf8');

const rowPaths = (window) =>
  window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path),
  );
const panelPaths = (window) => window.getByTestId('manage-folder-path').allTextContents();

// Sorted listing of every entry under `root`, relative, for the on-disk comparison.
function listing(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      out.push(path.relative(root, full));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out.sort();
}

// Selects the collection named 'Replace' (the seeded one) and waits for its tree.
async function selectReplace(window) {
  await window.getByTestId('collection-item').filter({ hasText: 'Replace' }).click();
  await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
}

async function collectionWith(userDataDir, name, roots) {
  const created = await createCollectionService({ storage: storeOf(userDataDir) }).createCollection(name, roots);
  return created.collection.id;
}

/*
 * Seeds one collection over `existing(fx)`, launches, adds `pick(fx)` through the panel with the
 * confirmation answers, waits for the add to finish, then hands `o` (the live session plus the
 * store before) to `check`. `check` closes the app itself when it needs the store.
 */
async function runCase({ label, existing, pick, answers, seedMore }, check) {
  const userDataDir = newUserDataDir(`replace-${label}`);
  const fx = { a: buildFixtureTree(), b: buildFixtureTree(), c: buildFixtureTree() };
  let session;
  try {
    const collectionId = await collectionWith(userDataDir, 'Replace', existing(fx));
    const extra = seedMore ? await seedMore(userDataDir, fx) : null;
    const storeBefore = readStore(userDataDir);
    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectReplace(window);
    const o = { fx, userDataDir, collectionId, extra, app, window, storeBefore, pickPath: pick(fx) };
    o.treeBefore = await rowPaths(window);
    o.panelBefore = await panelPaths(window);
    o.rescan = await gateChannel(app, CHANNELS.rescanCollection);
    o.add = async (ans = answers) => {
      await stubFolderPicker(app, [o.pickPath]);
      await stubConfirm(app, ans);
      await window.getByTestId('add-folder-button').click();
      await expect.poll(async () => (await confirmCalls(app)).length, { timeout: 30000 }).toBeGreaterThan(0);
      await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });
    };
    o.relaunch = async () => {
      session = await launchApp(userDataDir);
      await selectReplace(session.window);
      return session.window;
    };
    await check(o);
  } finally {
    if (session) await session.app.close().catch(() => {});
    for (const f of Object.values(fx)) cleanupFixtureTree(f.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

test('cancel: one confirmation naming the contained folder and "replaced"; nothing changes', async () => {
  const inner = (fx) => `${fx.a.root}/Photos`;
  await runCase({
    label: 'cancel', answers: [false], existing: (fx) => [inner(fx)], pick: (fx) => fx.a.root,
  }, async (o) => {
    await o.add();
    const calls = await confirmCalls(o.app);
    expect(calls).toHaveLength(1);
    const text = JSON.stringify(calls[0]);
    expect(text).toContain(inner(o.fx));
    expect(text).toContain('replaced');
    expect(text).toContain('Replace folders');
    expect(await rowPaths(o.window)).toEqual(o.treeBefore);
    expect(await panelPaths(o.window)).toEqual(o.panelBefore);
    await expect(o.window.getByTestId('manage-notice')).toBeHidden();
    await expect(o.window.getByTestId('manage-error')).toBeHidden();
    expect(await o.rescan.calls()).toBe(0);
    await o.app.close();
    expect(readStore(o.userDataDir)).toBe(o.storeBefore);
  });
});

test('confirm: the new folder replaces the contained one in panel, tree and store, and survives a relaunch', async () => {
  const inner = (fx) => `${fx.a.root}/Photos`;
  await runCase({
    label: 'confirm', answers: [true], existing: (fx) => [inner(fx)], pick: (fx) => fx.a.root,
  }, async (o) => {
    const oldFolder = storeOf(o.userDataDir).listFolders(o.collectionId)[0];
    const filesBefore = listing(o.fx.a.root);
    await o.add();
    expect(await confirmCalls(o.app)).toHaveLength(1);
    await expect(o.window.getByTestId('manage-folder-path')).toHaveText([o.fx.a.root]);
    await expect(rowAt(o.window, o.fx.a.root)).toBeVisible();
    await expect(rowAt(o.window, inner(o.fx))).toHaveCount(0);
    await expect(o.window.getByTestId('manage-notice')).toContainText(inner(o.fx));
    expect(await o.rescan.calls()).toBe(0);
    await o.app.close();

    const storage = storeOf(o.userDataDir);
    const folders = storage.listFolders(o.collectionId);
    expect(folders.map((f) => f.path)).toEqual([o.fx.a.root]);
    expect(folders.some((f) => f.id === oldFolder.id)).toBe(false);
    expect(storage.getIndex({ folderId: oldFolder.id })).toEqual([]);
    expect(storage.getFolderAccess(oldFolder.id)).toBeUndefined();
    expect(storage.getIndex({ folderId: folders[0].id }).length).toBeGreaterThan(0);
    expect(storage.getCollection(o.collectionId).folderIds).toEqual([folders[0].id]);
    expect(listing(o.fx.a.root)).toEqual(filesBefore);

    const window = await o.relaunch();
    await expect(window.getByTestId('manage-folder-path')).toHaveText([o.fx.a.root]);
    await expect(rowAt(window, o.fx.a.root)).toBeVisible();
    await expect(rowAt(window, inner(o.fx))).toHaveCount(0);
  });
});

test('selection: a file in the replaced folder is deselected, a file in an untouched folder stays selected', async () => {
  const inner = (fx) => `${fx.a.root}/Photos`;
  const opts = (label) => ({
    label, answers: [true], existing: (fx) => [inner(fx), fx.b.root], pick: (fx) => fx.a.root,
  });
  await runCase(opts('selection-replaced'), async (o) => {
    const file = `${inner(o.fx)}/A.JPG`;
    await rowAt(o.window, inner(o.fx)).click();
    await rowAt(o.window, file).click();
    await expect(rowAt(o.window, file)).toHaveAttribute('aria-selected', 'true');
    await expect(o.window.getByTestId('file-path')).toHaveText(file);

    await o.add();
    await expect(o.window.getByTestId('manage-folder-path')).toHaveText([o.fx.b.root, o.fx.a.root]);
    await expect(o.window.locator('[data-testid="tree-row"][aria-selected="true"]')).toHaveCount(0);
    await expect(o.window.getByTestId('file-path')).toHaveClass(/file-path-empty/);
    await expect(o.window.getByTestId('reveal')).toBeDisabled();
  });
  await runCase(opts('selection-kept'), async (o) => {
    const file = `${o.fx.b.root}/top.mp3`;
    await rowAt(o.window, o.fx.b.root).click();
    await rowAt(o.window, file).click();
    await expect(rowAt(o.window, file)).toHaveAttribute('aria-selected', 'true');

    await o.add();
    await expect(o.window.getByTestId('manage-folder-path')).toHaveText([o.fx.b.root, o.fx.a.root]);
    await expect(rowAt(o.window, file)).toHaveAttribute('aria-selected', 'true');
    await expect(o.window.getByTestId('file-path')).toHaveText(file);
    await expect(o.window.getByTestId('reveal')).toBeEnabled();
  });
});

test('several: of three folders a parent of two replaces those two and keeps the third', async () => {
  await runCase({
    label: 'several',
    answers: [true],
    existing: (fx) => [`${fx.a.root}/Photos`, fx.b.root, `${fx.a.root}/Docs`],
    pick: (fx) => fx.a.root,
  }, async (o) => {
    await o.add();
    const calls = await confirmCalls(o.app);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).toContain(`${o.fx.a.root}/Photos`);
    expect(JSON.stringify(calls[0])).toContain(`${o.fx.a.root}/Docs`);
    await expect(o.window.getByTestId('manage-folder-path')).toHaveText([o.fx.b.root, o.fx.a.root]);
    await o.app.close();
    const storage = storeOf(o.userDataDir);
    expect(storage.listFolders(o.collectionId).map((f) => f.path).sort()).toEqual([o.fx.a.root, o.fx.b.root].sort());
    expect(storage.getCollection(o.collectionId).folderIds).toHaveLength(2);
  });
});

test('all: a collection whose only folder is contained is replaced by the parent with no LAST_FOLDER error', async () => {
  await runCase({
    label: 'all', answers: [true], existing: (fx) => [`${fx.a.root}/Photos`], pick: (fx) => fx.a.root,
  }, async (o) => {
    await o.add();
    await expect(o.window.getByTestId('manage-error')).toBeHidden();
    await expect(o.window.getByTestId('manage-folder-path')).toHaveText([o.fx.a.root]);
    await expect(o.window.getByTestId('collection-item')).toContainText('(1 folders)');
  });
});

test('other collection: a second collection with the replaced path keeps its record, index and tree', async () => {
  const inner = (fx) => `${fx.a.root}/Photos`;
  await runCase({
    label: 'other',
    answers: [true],
    existing: (fx) => [inner(fx)],
    pick: (fx) => fx.a.root,
    seedMore: (userDataDir, fx) => collectionWith(userDataDir, 'Other', [inner(fx)]),
  }, async (o) => {
    const viewOf = (window) =>
      window.evaluate(async (id) => JSON.stringify(await window.mediaOrganizer.getCollectionView(id)), o.extra);
    const storeSnapshot = () => {
      const storage = storeOf(o.userDataDir);
      const folders = storage.listFolders(o.extra);
      return JSON.stringify({
        collection: storage.getCollection(o.extra),
        folders,
        index: folders.map((f) => storage.getIndex({ folderId: f.id })),
      });
    };
    const storeBefore = storeSnapshot();
    const viewBefore = await viewOf(o.window);
    await o.add();
    await expect(o.window.getByTestId('manage-folder-path')).toHaveText([o.fx.a.root]);
    expect(await viewOf(o.window)).toBe(viewBefore);
    await o.app.close();
    expect(storeSnapshot()).toBe(storeBefore);

    // After a relaunch the other collection still shows its files.
    const window = await o.relaunch();
    expect(await viewOf(window)).toBe(viewBefore);
    await window.getByTestId('collection-item').filter({ hasText: 'Other' }).click();
    await expect(rowAt(window, inner(o.fx))).toBeVisible({ timeout: 30000 });
    await rowAt(window, inner(o.fx)).click();
    await expect(rowAt(window, `${inner(o.fx)}/A.JPG`)).toBeVisible();
  });
});
