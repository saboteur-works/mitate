'use strict';

/*
 * One appearance of a file across overlapping roots e2e (Feature 3, Task 26; FR-9, FR-13).
 * A collection over one fixture folder is written to <userDataDir>/store.json before launch with
 * the real service + scanner; the overlapping folder is then added through the panel
 * (stubFolderPicker + stubConfirm true). The overlap rule itself is covered for a seeded store in
 * file-selection.spec.js; this spec adds what that one does not: the three overlap shapes built
 * through the UI, selection and the detail area, persistence of the single appearance across
 * Rescan, relaunch and a further add, and removing the outer root.
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
 * c.first / c.pick: the existing folder and the one added through the panel. Roots are the first and
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

async function runDedupCase(c) {
  const userDataDir = newUserDataDir(`dedup-${c.label}`);
  const fx = buildFixtureTree();
  const other = buildFixtureTree();
  const ctx = { R: fx.root };
  const sharedPath = `${fx.root}/${FILE}`;
  let session;
  try {
    const storage = storeOf(userDataDir);
    const created = await createCollectionService({ storage }).createCollection('Dedup', [c.first(fx.root)]);
    const collectionId = created.collection.id;

    session = await launchApp(userDataDir);
    let { app, window } = session;
    await selectOnlyCollection(window);

    // Add the overlapping folder through the panel, confirming the overlap.
    await stubFolderPicker(app, [c.pick(fx.root)]);
    await stubConfirm(app, [true]);
    await window.getByTestId('add-folder-button').click();
    await expect.poll(async () => (await confirmCalls(app)).length, { timeout: 30000 }).toBe(1);
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
    await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });

    const ids = storeSnapshot(userDataDir, collectionId).folderIds;
    expect(ids).toHaveLength(2);
    const outerId = ids[c.outerIndex];
    const innerId = ids[1 - c.outerIndex];

    // Single appearance under the owner; the other root row is still there.
    await expectOneAppearance(window, ctx, outerId, innerId, c.relOuter);
    // Nothing is stored for the dedup: both roots keep their own index records for the file.
    const withBoth = storeSnapshot(userDataDir, collectionId);
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

    // Adding an unrelated folder does not change it.
    await stubFolderPicker(app, [other.root]);
    await stubConfirm(app, []);
    await window.getByTestId('add-folder-button').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(3, { timeout: 30000 });
    await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });
    expect(await confirmCalls(app)).toHaveLength(1);
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
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(fx.root);
    cleanupFixtureTree(other.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

test('inside: a root and its subfolder added with confirm show each file once, under the outer root', async () => {
  await runDedupCase(CASES.inside);
});

test('contains: the subfolder first and then its parent show the same single appearance, under the parent', async () => {
  await runDedupCase(CASES.contains);
});

test('identical: the same path added twice shows each file once, under the earlier-added root', async () => {
  await runDedupCase(CASES.identical);
});
