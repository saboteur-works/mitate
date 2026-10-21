'use strict';

/*
 * Add folder refusal e2e (Feature 3, Tasks 20 and 34; FR-8 revised 2026-10-21, FR-13). A folder
 * inside or identical to an existing one (also through a symlink) is refused with FOLDER_COVERED:
 * the error shows in manage-error, nothing is written, nothing is scanned and no dialog is asked
 * (confirmCalls stays empty). The collection is written to <userDataDir>/store.json before launch
 * with the real service + scanner. The picker (stubFolderPicker) and the confirmation
 * (stubConfirm, recorded by confirmCalls) are stubbed in the main process, so no native dialog
 * opens. The contains case (replace) is in folder-replace.spec.js. The store is read from disk
 * after the app is closed.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, selectOnlyCollection, stubFolderPicker, gateChannel, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { CHANNELS } = require('../../src/main/ipc.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const rowPaths = (window) =>
  window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path),
  );

const panelPaths = (window) => window.getByTestId('manage-folder-path').allTextContents();

const readStore = (userDataDir) => fs.readFileSync(path.join(userDataDir, 'store.json'), 'utf8');

function folderRecords(userDataDir, collectionId) {
  return openStorage({ location: { baseDir: userDataDir } }).listFolders(collectionId);
}

const indexSize = (userDataDir) => openStorage({ location: { baseDir: userDataDir } }).getIndex().length;

/*
 * Seeds a collection over `existing(fx)`, launches, adds `pick(fx)` through the panel with the given
 * confirmation answers, closes the app and hands the observations to `check`. `fx` holds two
 * fixture trees (a, b) and a scratch directory (tmp) for symlinks. Everything is removed afterwards.
 */
async function runCase({ label, existing, pick, answers = [], refused = false }, check) {
  const userDataDir = newUserDataDir(`add-overlap-${label}`);
  const fx = { a: buildFixtureTree(), b: buildFixtureTree(), tmp: fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mitate-link-'))) };
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const created = await createCollectionService({ storage }).createCollection('Overlap', existing(fx));
    const collectionId = created.collection.id;
    const pickPath = pick(fx);
    const storeBefore = readStore(userDataDir);
    const indexBefore = indexSize(userDataDir);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    const treeBefore = await rowPaths(window);
    const panelBefore = await panelPaths(window);

    await stubFolderPicker(app, [pickPath]);
    const rescan = await gateChannel(app, CHANNELS.rescanCollection);
    await stubConfirm(app, answers);
    await window.getByTestId('add-folder-button').click();
    if (refused) await expect(window.getByTestId('manage-error')).toBeVisible({ timeout: 30000 });
    await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });

    const obs = {
      fx, userDataDir, collectionId, pickPath, window, storeBefore, indexBefore, treeBefore, panelBefore,
      errorText: refused ? await window.getByTestId('manage-error').textContent() : '',
      noticeHidden: await window.getByTestId('manage-notice').isHidden(),
      treeAfter: await rowPaths(window),
      panelAfter: await panelPaths(window),
      calls: await confirmCalls(app),
      rescanCalls: await rescan.calls(),
    };
    await app.close();
    obs.storeAfter = readStore(userDataDir);
    obs.indexAfter = indexSize(userDataDir);
    obs.records = folderRecords(userDataDir, collectionId);
    obs.relaunch = async () => {
      session = await launchApp(userDataDir);
      await selectOnlyCollection(session.window);
      return session.window;
    };
    await check(obs);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(fx.a.root);
    cleanupFixtureTree(fx.b.root);
    fs.rmSync(fx.tmp, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

function expectNothingChanged(o) {
  expect(o.treeAfter).toEqual(o.treeBefore);
  expect(o.panelAfter).toEqual(o.panelBefore);
  expect(o.storeAfter).toBe(o.storeBefore);
  expect(o.indexAfter).toBe(o.indexBefore);
  expect(o.rescanCalls).toBe(0);
  expect(o.calls).toEqual([]);
  expect(o.noticeHidden).toBe(true);
}

async function expectRelaunchPanel(o, expected) {
  const window = await o.relaunch();
  await expect(window.getByTestId('manage-folder-path')).toHaveText(expected);
}

test('inside: a subfolder of an existing folder is refused with "already covered" and nothing changes', async () => {
  await runCase({
    label: 'inside', refused: true, existing: (fx) => [fx.a.root], pick: (fx) => `${fx.a.root}/Photos`,
  }, async (o) => {
    expect(o.errorText).toContain('already covered');
    expect(o.errorText).toContain(o.fx.a.root);
    expectNothingChanged(o);
    expect(o.records.map((f) => f.path)).toEqual([o.fx.a.root]);
    await expectRelaunchPanel(o, [o.fx.a.root]);
  });
});

test('identical: the same path added again is refused with "already in the collection"; one record remains', async () => {
  await runCase({
    label: 'identical', refused: true, existing: (fx) => [fx.a.root], pick: (fx) => fx.a.root,
  }, async (o) => {
    expect(o.errorText).toContain('already in the collection');
    expect(o.records.filter((f) => f.path === o.fx.a.root)).toHaveLength(1);
    expectNothingChanged(o);
  });
});

test('symlink: a link to an existing folder is refused as already in the collection; nothing changes', async () => {
  const link = (fx) => path.join(fx.tmp, 'link-to-a');
  let linked = true;
  await runCase({
    label: 'symlink',
    refused: true,
    existing: (fx) => [fx.a.root],
    pick: (fx) => {
      try {
        fs.symlinkSync(fx.a.root, link(fx));
      } catch (err) {
        linked = false;
      }
      return link(fx);
    },
  }, async (o) => {
    test.skip(!linked, 'the platform refused to create a symlink in the temp directory');
    // The link resolves to the existing folder itself, so it is the identical case.
    expect(o.errorText).toContain('already in the collection');
    expect(o.errorText).toContain(o.fx.a.root);
    expectNothingChanged(o);
  });
});

test('inside, second collection: the subfolder is accepted into a collection that does not hold the parent', async () => {
  const userDataDir = newUserDataDir('add-overlap-second');
  const a = buildFixtureTree();
  const b = buildFixtureTree();
  const inner = `${a.root}/Photos`;
  let session;
  try {
    const service = createCollectionService({ storage: openStorage({ location: { baseDir: userDataDir } }) });
    await service.createCollection('Holds parent', [a.root]);
    const second = await service.createCollection('Other', [b.root]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await window.getByTestId('collection-item').filter({ hasText: 'Other' }).click();
    await expect(window.getByTestId('manage-folder-path')).toHaveText([b.root], { timeout: 30000 });

    await stubFolderPicker(app, [inner]);
    await stubConfirm(app, []);
    await window.getByTestId('add-folder-button').click();
    await expect(window.getByTestId('manage-folder-path')).toHaveText([b.root, inner], { timeout: 30000 });
    await expect(window.getByTestId('manage-error')).toBeHidden();
    expect(await confirmCalls(app)).toEqual([]);

    await app.close();
    expect(folderRecords(userDataDir, second.collection.id).map((f) => f.path)).toEqual([b.root, inner]);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(a.root);
    cleanupFixtureTree(b.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('unrelated: a folder that overlaps nothing is added with no confirmation', async () => {
  await runCase({
    label: 'unrelated', answers: [], existing: (fx) => [fx.a.root], pick: (fx) => fx.b.root,
  }, async (o) => {
    expect(o.calls).toEqual([]);
    expect(o.panelAfter).toEqual([o.fx.a.root, o.fx.b.root]);
    expect(o.records.map((f) => f.path)).toEqual([o.fx.a.root, o.fx.b.root]);
    expect(o.rescanCalls).toBe(0);
    await expectRelaunchPanel(o, [o.fx.a.root, o.fx.b.root]);
  });
});
