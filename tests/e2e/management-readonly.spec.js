'use strict';

/*
 * Read-only check around every management flow (Feature 3, Tasks 27 and 39; FR-10, US-3).
 *
 * Fixture tree -> two collections over it through the service (Alpha: the root; Beta: Docs, Music
 * and Photos/2024 inside it) -> read-only snapshot 'before' (app closed) -> launch, rename, switch,
 * add a subfolder of the root (refused, FOLDER_COVERED), add Photos to Beta (replace on contains,
 * the confirmation answered), remove folder, create a collection from nested picks (the inner one
 * is dropped with a notice, no confirmation), delete a collection, quit -> snapshot 'after' (app
 * closed) -> assert no non-atime differences. Access-time differences never fail the test; they are
 * attached to the test output and logged. The first test confirms every confirmation, the second
 * cancels every one. The folder picker and the confirmation dialog are stubbed in the main process.
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
const readonlyCheck = require('../../tools/readonly-check/index.js');

// atimeNs may be a BigInt, which JSON.stringify cannot serialize.
const toJson = (value) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

const itemNamed = (window, name) =>
  window.getByTestId('collection-item').filter({
    has: window.getByTestId('collection-name-label').getByText(name, { exact: true }),
  });

const storedPaths = (userDataDir, name) => {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  const collection = storage.listCollections().find((c) => c.name === name);
  return collection ? storage.listFolders(collection.id).map((f) => f.path) : null;
};

async function selectByName(window, name) {
  await itemNamed(window, name).click();
  await expect(itemNamed(window, name)).toHaveClass(/collection-selected/);
  await expect(window.getByTestId('rename-input')).toHaveValue(name);
}

// Adds `pick` to the selected collection through the panel and answers the replace confirmation
// with `ok`. Resolves once the add has finished (controls enabled again).
async function addFolder(app, window, pick, ok, callsSoFar) {
  await stubFolderPicker(app, [pick]);
  await stubConfirm(app, [ok]);
  await window.getByTestId('add-folder-button').click();
  await expect.poll(async () => (await confirmCalls(app)).length, { timeout: 30000 }).toBe(callsSoFar + 1);
  await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });
}

async function runSequence(label, ok) {
  test.setTimeout(180000);
  const userDataDir = newUserDataDir(`mgmt-readonly-${label}`);
  const fixture = buildFixtureTree();
  const root = fixture.root;
  const docs = `${root}/Docs`;
  const music = `${root}/Music`;
  const photos = `${root}/Photos`;
  const year = `${root}/Photos/2024`;
  let session;
  try {
    // FR-10: app storage lives outside the fixture root.
    expect(path.relative(fs.realpathSync(root), fs.realpathSync(userDataDir)).startsWith('..')).toBe(true);

    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    await service.createCollection('Alpha', [root]);
    await service.createCollection('Beta', [docs, music, year]);

    // Snapshot with the app closed (ordering rule in tools/readonly-check).
    const before = readonlyCheck.snapshot(root, { role: 'before' });

    session = await launchApp(userDataDir);
    const { app, window } = session;
    const byId = (id) => window.getByTestId(id);
    const panelPaths = () => byId('manage-folder-path').allTextContents();
    await expect(byId('collection-item')).toHaveCount(2, { timeout: 30000 });
    let calls = 0;

    // Rename Alpha.
    await itemNamed(window, 'Alpha').click();
    await expect(rowAt(window, root)).toBeVisible({ timeout: 30000 });
    await byId('rename-input').fill('Renamed');
    await byId('rename-button').click();
    await expect(itemNamed(window, 'Renamed')).toHaveCount(1, { timeout: 5000 });
    await expect(itemNamed(window, 'Alpha')).toHaveCount(0);

    // Switch to Beta, then back to the renamed collection.
    await selectByName(window, 'Beta');
    await expect(rowAt(window, docs)).toBeVisible({ timeout: 30000 });
    await expect(rowAt(window, music)).toBeVisible();
    await expect(rowAt(window, root)).toHaveCount(0);
    expect(await panelPaths()).toEqual([docs, music, year]);
    await selectByName(window, 'Renamed');
    await expect(rowAt(window, root)).toBeVisible({ timeout: 30000 });
    expect(await panelPaths()).toEqual([root]);

    // Add a subfolder of the root to the renamed collection: refused, nothing asked, nothing written.
    await stubFolderPicker(app, [photos]);
    await stubConfirm(app, [ok]);
    await byId('add-folder-button').click();
    await expect(byId('manage-error')).toBeVisible({ timeout: 30000 });
    await expect(byId('manage-error')).toContainText('already covered');
    await expect(byId('manage-error')).toContainText(root);
    await expect(byId('add-folder-button')).toBeEnabled({ timeout: 30000 });
    await expect(byId('manage-notice')).toBeHidden();
    expect(await panelPaths()).toEqual([root]);
    await expect(itemNamed(window, 'Renamed')).toContainText('(1 folders)');
    expect(await confirmCalls(app)).toEqual([]);

    // Add Photos to Beta, which holds Photos/2024: replace on contains (confirmed or cancelled).
    await selectByName(window, 'Beta');
    await expect(rowAt(window, docs)).toBeVisible({ timeout: 30000 });
    await addFolder(app, window, photos, ok, calls);
    calls += 1;
    await expect(byId('manage-folder-path')).toHaveText(ok ? [docs, music, photos] : [docs, music, year]);
    if (ok) {
      await expect(byId('manage-notice')).toBeVisible();
      await expect(byId('manage-notice')).toContainText(year);
      await expect(rowAt(window, photos)).toBeVisible();
      await expect(rowAt(window, year)).toHaveCount(0);
    } else {
      await expect(byId('manage-notice')).toBeHidden();
      await expect(rowAt(window, year)).toBeVisible();
    }

    // Remove a folder from Beta (no confirmation).
    await byId('manage-folder')
      .filter({ has: byId('manage-folder-path').getByText(music, { exact: true }) })
      .getByTestId('remove-folder')
      .click();
    await expect(byId('manage-folder-path')).toHaveText(ok ? [docs, photos] : [docs, year]);
    await expect(rowAt(window, music)).toHaveCount(0);

    // Create a collection from nested picks: the inner pick is dropped with a notice, no confirmation.
    await stubFolderPicker(app, [photos, year]);
    await byId('add-folder').click();
    await byId('collection-name').fill('Gamma');
    await expect(byId('folder-item')).toHaveCount(2);
    await byId('create-collection').click();
    await expect(itemNamed(window, 'Gamma')).toHaveCount(1, { timeout: 30000 });
    await expect(itemNamed(window, 'Gamma').getByTestId('collection-folder-count')).toHaveText('1');
    await expect(byId('create-notice')).toBeVisible();
    await expect(byId('create-notice')).toContainText(year);
    await expect(byId('create-notice')).toContainText(photos);
    await expect(byId('folder-item')).toHaveCount(0);
    await expect(byId('collection-item')).toHaveCount(3);
    expect(await confirmCalls(app)).toHaveLength(calls);

    // Delete a collection (confirmed: Gamma goes; cancelled: Gamma stays).
    await selectByName(window, 'Gamma');
    await stubConfirm(app, [ok]);
    await byId('delete-collection-button').click();
    await expect.poll(async () => (await confirmCalls(app)).length, { timeout: 30000 }).toBe(calls + 1);
    calls += 1;
    if (ok) {
      await expect(itemNamed(window, 'Gamma')).toHaveCount(0, { timeout: 5000 });
      await expect(byId('collection-item')).toHaveCount(2);
    } else {
      await expect(byId('delete-collection-button')).toBeEnabled();
      await expect(itemNamed(window, 'Gamma')).toHaveCount(1);
      await expect(byId('collection-item')).toHaveCount(3);
    }
    expect(await confirmCalls(app)).toHaveLength(2);

    await app.close();
    session = null;

    // The completed steps reached the store (confirmed run) or did not (cancelled run).
    expect(storedPaths(userDataDir, 'Alpha')).toBeNull();
    expect(storedPaths(userDataDir, 'Renamed')).toEqual([root]);
    expect(storedPaths(userDataDir, 'Beta')).toEqual(ok ? [docs, photos] : [docs, year]);
    expect(storedPaths(userDataDir, 'Gamma')).toEqual(ok ? null : [photos]);

    const after = readonlyCheck.snapshot(root, { role: 'after' });
    const atime = readonlyCheck.compare(before, after).atime;
    const report = toJson({ root, confirmed: ok, atimeDifferenceCount: atime.length, atime });
    await test.info().attach('atime-report.json', { body: report, contentType: 'application/json' });
    console.log(`read-only check atime report: ${report}`);

    // Throws on any non-atime difference; atime differences never fail (failOnAtime false).
    readonlyCheck.assert(before, after, { failOnAtime: false });
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

test('rename, switch, refused add, replace, remove, create from nested picks and delete, all confirmed, leave the fixture tree unchanged', async () => {
  await runSequence('confirm', true);
});

test('the same sequence with every confirmation cancelled leaves the fixture tree unchanged', async () => {
  await runSequence('cancel', false);
});
