'use strict';

/*
 * One appearance of a file across nested roots in legacy data e2e (Feature 3, Tasks 26 and 37; FR-9,
 * FR-13). Since 2026-10-21 the UI no longer builds nested or identical roots (inside and identical
 * adds are refused, a containing add replaces, creation drops nested picks), so these shapes are
 * seeded into <userDataDir>/store.json before launch as legacy data (two folder records of one
 * collection, written with openStorage over the real scanner output). The tree-model de-duplication
 * stays as the safety net: each file shows once, under the owning root, and the other root row is
 * still there. No migration rewrites the store. The last test builds the same shapes through the
 * panel and the creation screen and asserts that the store ends without nesting.
 *
 * The tree is virtualized, so rows are addressed by node id (<rootFolderId>:<relativePath>) and
 * only the roots and folders on the way to one file are expanded. Store reads happen between UI
 * steps (the app is idle) and after the app is closed.
 */

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, rowAt, selectOnlyCollection, stubFolderPicker, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const byId = (window, id) => window.locator(`[data-testid="tree-row"][data-node-id="${id}"]`);
const selectedRows = (window) => window.locator('[data-testid="tree-row"][aria-selected="true"]');
const nodeIdsAt = (window, p) =>
  window.evaluate(
    (target) =>
      [...document.querySelectorAll('[data-testid="tree-row"]')]
        .filter((r) => r.dataset.path === target)
        .map((r) => r.dataset.nodeId),
    p,
  );

// Expands the row unless it is already expanded (a click on an expanded row would collapse it).
async function expand(window, id) {
  const row = byId(window, id);
  await expect(row).toHaveCount(1);
  if ((await row.getAttribute('aria-expanded')) === 'false') await row.click();
}

const storeOf = (userDataDir) => openStorage({ location: { baseDir: userDataDir } });

function storeSnapshot(userDataDir, collectionId) {
  const storage = storeOf(userDataDir);
  return {
    folderIds: storage.getCollection(collectionId).folderIds,
    folders: storage.listFolders(collectionId).map((f) => `${f.id} ${f.path}`).sort(),
    index: storage.getIndex({ collectionId }).map((r) => `${r.folderId} ${r.relativePath} ${r.path}`).sort(),
  };
}

/*
 * c.first / c.pick: the first and the second folder seeded into the collection. Roots are the first and
 * second folder ids; outer / inner say which of them owns the shared file. outerIndex is the panel
 * position of the owner. relInner is the shared file's relative path under the inner root, relOuter
 * under the outer one.
 */
const FILE = 'Photos/A.JPG';
const CASES = {
  inside: {
    label: 'inside', first: (r) => r, pick: (r) => `${r}/Photos`, outerIndex: 0,
    relOuter: FILE, relInner: 'A.JPG', keepSelection: true,
  },
  contains: {
    label: 'contains', first: (r) => `${r}/Photos`, pick: (r) => r, outerIndex: 1,
    relOuter: FILE, relInner: 'A.JPG', keepSelection: false,
  },
  identical: {
    label: 'identical', first: (r) => r, pick: (r) => r, outerIndex: 0,
    relOuter: FILE, relInner: FILE, keepSelection: false,
  },
};

// Opens the roots and folders needed to see the shared file under `ownerId`, and checks it is the
// only row for that path, owned by `ownerId`, with the other root still present.
async function expectOneAppearance(window, ctx, ownerId, otherId, rel) {
  const sharedPath = `${ctx.R}/${FILE}`;
  for (const id of [otherId, ownerId]) await expand(window, `${id}:`);
  const parts = rel.split('/');
  for (let i = 1; i < parts.length; i += 1) await expand(window, `${ownerId}:${parts.slice(0, i).join('/')}`);
  await expect(byId(window, `${ownerId}:${rel}`)).toHaveAttribute('data-path', sharedPath);
  expect(await nodeIdsAt(window, sharedPath)).toEqual([`${ownerId}:${rel}`]);
  await expect(rowAt(window, sharedPath)).toHaveCount(1);
  await expect(byId(window, `${otherId}:`)).toHaveCount(1);
}

// Writes a collection with two folder records, `firstPath` then `secondPath` in folderIds, for the
// (possibly nested or identical) paths. Records and index entries come from the real scanner via
// a throwaway collection per folder; the ids are fresh, so the store looks like one written by
// Feature 1 or by the earlier confirm-and-keep-both behaviour.
async function seedLegacy(userDataDir, firstPath, secondPath) {
  const storage = storeOf(userDataDir);
  const service = createCollectionService({ storage });
  const copies = [];
  for (const dirPath of [firstPath, secondPath]) {
    const tmp = await service.createCollection('tmp', [dirPath]);
    const [folder] = storage.listFolders(tmp.collection.id);
    copies.push({ path: dirPath, records: storage.getIndex({ folderId: folder.id }) });
    storage.removeCollection(tmp.collection.id);
  }
  const collectionId = 'legacy-collection';
  storage.putCollection({ id: collectionId, name: 'Dedup', folderIds: [], createdAt: new Date().toISOString() });
  copies.forEach((copy, i) => {
    const id = `legacy-folder-${i + 1}`;
    storage.putFolder({ id, collectionId, path: copy.path, unavailable: false });
    storage.replaceFolderIndex(id, copy.records.map(({ folderId, collectionId: _c, ...rest }) => rest));
  });
  return collectionId;
}

async function runDedupCase(c) {
  const userDataDir = newUserDataDir(`dedup-${c.label}`);
  const fx = buildFixtureTree();
  const other = buildFixtureTree();
  const ctx = { R: fx.root };
  const sharedPath = `${fx.root}/${FILE}`;
  let session;
  try {
    const collectionId = await seedLegacy(userDataDir, c.first(fx.root), c.pick(fx.root));
    const seeded = storeSnapshot(userDataDir, collectionId);
    const storeBytes = fs.readFileSync(`${userDataDir}/store.json`);

    session = await launchApp(userDataDir);
    let { app, window } = session;
    await selectOnlyCollection(window);
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });

    // Launching and building the tree changed nothing in the store (no migration, no write).
    expect(fs.readFileSync(`${userDataDir}/store.json`).equals(storeBytes)).toBe(true);
    const ids = seeded.folderIds;
    expect(ids).toHaveLength(2);
    const outerId = ids[c.outerIndex];
    const innerId = ids[1 - c.outerIndex];

    // Single appearance under the owner; the other root row is still there.
    await expectOneAppearance(window, ctx, outerId, innerId, c.relOuter);
    // Nothing is stored for the dedup: both roots keep their own index records for the file.
    const withBoth = storeSnapshot(userDataDir, collectionId);
    expect(withBoth).toEqual(seeded);
    expect(withBoth.index.filter((r) => r.endsWith(` ${sharedPath}`))).toHaveLength(2);

    // Clicking the file selects exactly one row and the detail shows the path once.
    await byId(window, `${outerId}:${c.relOuter}`).click();
    await expect(selectedRows(window)).toHaveCount(1);
    await expect(byId(window, `${outerId}:${c.relOuter}`)).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('file-path')).toHaveText(sharedPath);

    // Rescan: still one appearance, same owner.
    await window.getByTestId('rescan').click();
    await expect(window.getByTestId('rescan-status')).toContainText('Rescanned 2 folders', { timeout: 30000 });
    await expectOneAppearance(window, ctx, outerId, innerId, c.relOuter);
    const rescanned = storeSnapshot(userDataDir, collectionId);
    expect(rescanned.folderIds).toEqual(seeded.folderIds);
    expect(rescanned.folders).toEqual(seeded.folders);

    // Adding an unrelated folder does not change it.
    await stubFolderPicker(app, [other.root]);
    await stubConfirm(app, []);
    await window.getByTestId('add-folder-button').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(3, { timeout: 30000 });
    await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });
    expect(await confirmCalls(app)).toEqual([]);
    await expectOneAppearance(window, ctx, outerId, innerId, c.relOuter);

    // Relaunch: the same single appearance from the stored data.
    await app.close();
    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await selectOnlyCollection(window);
    await expect(window.getByTestId('manage-folder')).toHaveCount(3);
    await expectOneAppearance(window, ctx, outerId, innerId, c.relOuter);
    await byId(window, `${outerId}:${c.relOuter}`).click();
    await expect(selectedRows(window)).toHaveCount(1);
    await expect(window.getByTestId('file-path')).toHaveText(sharedPath);

    // When the selection should survive the removal, move it to a file of the unrelated root
    // (collapse the owner first so that root's rows are inside the virtual window).
    const otherId = storeSnapshot(userDataDir, collectionId).folderIds[2];
    const otherFile = `${other.root}/top.mp3`;
    if (c.keepSelection) {
      await byId(window, `${outerId}:`).click();
      await expand(window, `${otherId}:`);
      await byId(window, `${otherId}:top.mp3`).click();
      await expect(window.getByTestId('file-path')).toHaveText(otherFile);
    }

    // Remove the outer root.
    const before = storeSnapshot(userDataDir, collectionId);
    await window.getByTestId('manage-folder').nth(c.outerIndex).getByTestId('remove-folder').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 5000 });
    await expect(byId(window, `${outerId}:`)).toHaveCount(0);
    await expect(byId(window, `${innerId}:`)).toHaveCount(1);

    // The file now appears once, under the inner root.
    await expand(window, `${innerId}:`);
    const innerParts = c.relInner.split('/');
    for (let i = 1; i < innerParts.length; i += 1) await expand(window, `${innerId}:${innerParts.slice(0, i).join('/')}`);
    await expect(byId(window, `${innerId}:${c.relInner}`)).toHaveAttribute('data-path', sharedPath);
    expect(await nodeIdsAt(window, sharedPath)).toEqual([`${innerId}:${c.relInner}`]);

    // Selection: kept only when its node id still exists, otherwise cleared with the empty state.
    if (c.keepSelection) {
      await expect(byId(window, `${otherId}:top.mp3`)).toHaveAttribute('aria-selected', 'true');
      await expect(selectedRows(window)).toHaveCount(1);
      await expect(window.getByTestId('file-path')).toHaveText(otherFile);
    } else {
      await expect(selectedRows(window)).toHaveCount(0);
      await expect(window.getByTestId('file-path')).toHaveClass(/file-path-empty/);
      await expect(window.getByTestId('file-path')).not.toContainText(sharedPath);
    }

    // The store changed only by the removed folder and its own index records.
    await app.close();
    const after = storeSnapshot(userDataDir, collectionId);
    expect(after.folderIds).toEqual(before.folderIds.filter((id) => id !== outerId));
    expect(after.folders).toEqual(before.folders.filter((f) => !f.startsWith(`${outerId} `)));
    expect(after.index).toEqual(before.index.filter((r) => !r.startsWith(`${outerId} `)));
    expect(after.index.filter((r) => r.endsWith(` ${sharedPath}`))).toHaveLength(1);
    expect(after.folders).toHaveLength(2);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(fx.root);
    cleanupFixtureTree(other.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

test('inside (legacy): a root and its subfolder show each file once, under the outer root', async () => {
  await runDedupCase(CASES.inside);
});

test('contains (legacy): the subfolder first and then its parent show the same single appearance, under the parent', async () => {
  await runDedupCase(CASES.contains);
});

test('identical (legacy): the same path twice shows each file once, under the earlier root in folderIds', async () => {
  await runDedupCase(CASES.identical);
});

test('UI: the panel and the creation screen no longer build nested or identical roots', async () => {
  const userDataDir = newUserDataDir('dedup-ui');
  const fx = buildFixtureTree();
  const inner = `${fx.root}/Photos`;
  let session;
  try {
    const service = createCollectionService({ storage: storeOf(userDataDir) });
    await service.createCollection('Outer', [fx.root]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    const byId = (id) => window.getByTestId(id);
    await selectOnlyCollection(window);

    // Inside and identical adds are refused.
    for (const pick of [inner, fx.root]) {
      await stubFolderPicker(app, [pick]);
      await byId('add-folder-button').click();
      await expect(byId('manage-error')).toBeVisible({ timeout: 30000 });
      await expect(byId('add-folder-button')).toBeEnabled({ timeout: 30000 });
      await expect(byId('manage-folder-path')).toHaveText([fx.root]);
    }

    // Creation drops the nested pick.
    await stubFolderPicker(app, [inner, fx.root]);
    await byId('add-folder').click();
    await byId('collection-name').fill('Created');
    await byId('create-collection').click();
    await expect(byId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await expect(byId('create-notice')).toBeVisible();

    // A containing add replaces: a collection holding the subfolder gets its parent.
    await stubFolderPicker(app, [inner]);
    await byId('add-folder').click();
    await byId('collection-name').fill('Inner');
    await byId('create-collection').click();
    await expect(byId('collection-item')).toHaveCount(3, { timeout: 30000 });
    await byId('collection-item').filter({ hasText: 'Inner' }).click();
    await expect(byId('manage-folder-path')).toHaveText([inner], { timeout: 30000 });
    await stubFolderPicker(app, [fx.root]);
    await stubConfirm(app, [true]);
    await byId('add-folder-button').click();
    await expect(byId('manage-folder-path')).toHaveText([fx.root], { timeout: 30000 });

    await app.close();
    const storage = storeOf(userDataDir);
    for (const collection of storage.listCollections()) {
      expect(storage.listFolders(collection.id).map((f) => f.path)).toEqual([fx.root]);
    }
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(fx.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
