'use strict';

/*
 * Remove folder, selection rule and last-folder refusal e2e (Feature 3, Task 18; FR-3, FR-13).
 * A selected file stays selected after a removal only if its tree node still exists; removing the
 * only folder is refused with a message in manage-error and nothing is written.
 */

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, rowAt, selectOnlyCollection } = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const topOf = (root) => `${root}/top.mp3`;

const entryFor = (window, folderPath) =>
  window.getByTestId('manage-folder').filter({
    has: window.getByTestId('manage-folder-path').getByText(folderPath, { exact: true }),
  });

// Expands the root and selects its top-level file.
async function selectTopFile(window, root) {
  await rowAt(window, root).click();
  await rowAt(window, topOf(root)).click();
  await expect(rowAt(window, topOf(root))).toHaveAttribute('aria-selected', 'true');
  await expect(window.getByTestId('file-path')).toHaveText(topOf(root));
}

async function expectNothingSelected(window) {
  await expect(window.locator('[data-testid="tree-row"][aria-selected="true"]')).toHaveCount(0);
  await expect(window.getByTestId('file-path')).toHaveClass(/file-path-empty/);
  await expect(window.getByTestId('file-path')).not.toContainText('top.mp3');
  await expect(window.getByTestId('reveal')).toBeDisabled();
}

test('removing the other folder keeps a selected file selected; removing its folder clears the selection', async () => {
  const userDataDir = newUserDataDir('folder-remove-sel-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  const third = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Three', [first.root, second.root, third.root]);

    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);
    await expect(window.getByTestId('manage-folder')).toHaveCount(3);

    // A file in the kept folder stays selected when another folder is removed.
    await selectTopFile(window, first.root);
    await entryFor(window, second.root).getByTestId('remove-folder').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 2000 });
    await expect(rowAt(window, second.root)).toHaveCount(0);
    await expect(rowAt(window, topOf(first.root))).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('file-path')).toHaveText(topOf(first.root));
    await expect(window.getByTestId('reveal')).toBeEnabled();

    // A file in the folder that is then removed: the selection is cleared.
    await selectTopFile(window, third.root);
    await entryFor(window, third.root).getByTestId('remove-folder').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(1, { timeout: 2000 });
    await expect(rowAt(window, third.root)).toHaveCount(0);
    await expectNothingSelected(window);
  } finally {
    if (session) await session.app.close().catch(() => {});
    for (const t of [first, second, third]) cleanupFixtureTree(t.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('removing the last remaining folder is refused and nothing is stored', async () => {
  const userDataDir = newUserDataDir('folder-remove-last-e2e');
  const only = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const { collection } = await createCollectionService({ storage }).createCollection('Solo', [only.root]);
    const folderIds = storage.getCollection(collection.id).folderIds;

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    await selectTopFile(window, only.root);

    await window.getByTestId('remove-folder').click();
    await expect(window.getByTestId('manage-error')).toBeVisible();
    await expect(window.getByTestId('manage-error')).toContainText('delete the collection');
    await expect(window.getByTestId('manage-folder')).toHaveCount(1);
    await expect(window.getByTestId('remove-folder')).toHaveCount(1);
    await expect(rowAt(window, topOf(only.root))).toHaveAttribute('aria-selected', 'true');

    await app.close();
    const reopened = openStorage({ location: { baseDir: userDataDir } });
    expect(reopened.getCollection(collection.id).folderIds).toEqual(folderIds);
    expect(reopened.listFolders(collection.id).map((f) => f.path)).toEqual([only.root]);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(only.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a folder removed from a non-active collection through the channel leaves the shown tree and selection', async () => {
  const userDataDir = newUserDataDir('folder-remove-other-e2e');
  const shown = buildFixtureTree();
  const otherA = buildFixtureTree();
  const otherB = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    await service.createCollection('Shown', [shown.root]);
    const other = await service.createCollection('Other', [otherA.root, otherB.root]);
    const otherFolders = storage.listFolders(other.collection.id);
    const removedId = otherFolders.find((f) => f.path === otherB.root).id;

    session = await launchApp(userDataDir);
    const { window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await window.getByTestId('collection-item').filter({ hasText: 'Shown' }).click();
    await expect(rowAt(window, shown.root)).toBeVisible({ timeout: 30000 });
    await selectTopFile(window, shown.root);
    const rowsBefore = await window.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path));

    const result = await window.evaluate(
      ([cid, fid]) => window.mediaOrganizer.removeFolder(cid, fid),
      [other.collection.id, removedId],
    );
    expect(result.ok).toBe(true);

    // Nothing visible changes: same rows, same selection, same panel list.
    const rowsAfter = await window.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path));
    expect(rowsAfter).toEqual(rowsBefore);
    await expect(rowAt(window, topOf(shown.root))).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('file-path')).toHaveText(topOf(shown.root));
    await expect(entryFor(window, shown.root)).toHaveCount(1);
    await expect(window.getByTestId('manage-folder')).toHaveCount(1);
  } finally {
    if (session) await session.app.close().catch(() => {});
    for (const t of [shown, otherA, otherB]) cleanupFixtureTree(t.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
