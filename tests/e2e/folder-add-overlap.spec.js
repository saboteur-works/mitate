'use strict';

/*
 * Add folder overlap confirmation e2e (Feature 3, Task 20; FR-8, FR-13). The collection is
 * written to <userDataDir>/store.json before launch with the real service + scanner. The picker
 * (stubFolderPicker) and the confirmation (stubConfirm, recorded by confirmCalls) are stubbed in
 * the main process, so no native dialog opens. The overlap check and the dialog text come from the
 * real service. The store is read from disk after the app is closed.
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
async function runCase({ label, existing, pick, answers }, check) {
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
    if (answers.length > 0) await expect.poll(async () => (await confirmCalls(app)).length, { timeout: 30000 }).toBe(1);
    await expect(window.getByTestId('add-folder-button')).toBeEnabled({ timeout: 30000 });

    const obs = {
      fx, userDataDir, collectionId, pickPath, window, storeBefore, indexBefore, treeBefore, panelBefore,
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

const textOf = (call) => JSON.stringify(call);

function expectNothingChanged(o) {
  expect(o.treeAfter).toEqual(o.treeBefore);
  expect(o.panelAfter).toEqual(o.panelBefore);
  expect(o.storeAfter).toBe(o.storeBefore);
  expect(o.indexAfter).toBe(o.indexBefore);
  expect(o.rescanCalls).toBe(0);
}

async function expectRelaunchPanel(o, expected) {
  const window = await o.relaunch();
  await expect(window.getByTestId('manage-folder-path')).toHaveText(expected);
}

test.describe('inside: the new folder is inside an existing one', () => {
  const opts = (answers) => ({
    label: 'inside', answers, existing: (fx) => [fx.a.root], pick: (fx) => `${fx.a.root}/Photos`,
  });

  test('cancel: one confirmation naming the existing folder; tree, panel and store unchanged', async () => {
    await runCase(opts([false]), async (o) => {
      expect(o.calls).toHaveLength(1);
      expect(textOf(o.calls[0])).toContain('already covered');
      expect(textOf(o.calls[0])).toContain(o.fx.a.root);
      expectNothingChanged(o);
      await expectRelaunchPanel(o, [o.fx.a.root]);
    });
  });

  test('confirm: the folder is added, both are kept, and both survive a relaunch', async () => {
    await runCase(opts([true]), async (o) => {
      expect(o.calls).toHaveLength(1);
      expect(textOf(o.calls[0])).toContain('already covered');
      expect(o.panelAfter).toEqual([o.fx.a.root, o.pickPath]);
      expect(o.records.map((f) => f.path)).toEqual([o.fx.a.root, o.pickPath]);
      expect(o.rescanCalls).toBe(0);
      await expectRelaunchPanel(o, [o.fx.a.root, o.pickPath]);
    });
  });
});

test.describe('contains: the new folder contains an existing one', () => {
  const opts = (answers) => ({
    label: 'contains', answers, existing: (fx) => [`${fx.a.root}/Photos`], pick: (fx) => fx.a.root,
  });
  const sentence = 'the collection already contains a folder inside the one being added';

  test('cancel: asks naming the inner folder; nothing changes', async () => {
    await runCase(opts([false]), async (o) => {
      expect(o.calls).toHaveLength(1);
      expect(textOf(o.calls[0])).toContain(sentence);
      expect(textOf(o.calls[0])).toContain(`${o.fx.a.root}/Photos`);
      expectNothingChanged(o);
    });
  });

  test('confirm: keeps both folders, also after a relaunch', async () => {
    await runCase(opts([true]), async (o) => {
      expect(o.calls).toHaveLength(1);
      expect(textOf(o.calls[0])).toContain(sentence);
      expect(o.panelAfter).toEqual([`${o.fx.a.root}/Photos`, o.fx.a.root]);
      expect(o.rescanCalls).toBe(0);
      await expectRelaunchPanel(o, [`${o.fx.a.root}/Photos`, o.fx.a.root]);
    });
  });
});

test.describe('identical: the same path is added again', () => {
  const opts = (answers) => ({
    label: 'identical', answers, existing: (fx) => [fx.a.root], pick: (fx) => fx.a.root,
  });

  test('cancel: asks; one folder record for the path remains', async () => {
    await runCase(opts([false]), async (o) => {
      expect(o.calls).toHaveLength(1);
      expect(textOf(o.calls[0])).toContain('already covered');
      expect(o.records.filter((f) => f.path === o.fx.a.root)).toHaveLength(1);
      expectNothingChanged(o);
    });
  });

  test('confirm: two records for the path with different ids', async () => {
    await runCase(opts([true]), async (o) => {
      expect(o.calls).toHaveLength(1);
      expect(textOf(o.calls[0])).toContain('already covered');
      const same = o.records.filter((f) => f.path === o.fx.a.root);
      expect(same).toHaveLength(2);
      expect(same[0].id).not.toBe(same[1].id);
      expect(o.rescanCalls).toBe(0);
      await expectRelaunchPanel(o, [o.fx.a.root, o.fx.a.root]);
    });
  });
});

test('symlink: a link to an existing folder asks with "already covered"; cancel changes nothing', async () => {
  const link = (fx) => path.join(fx.tmp, 'link-to-a');
  let linked = true;
  await runCase({
    label: 'symlink',
    answers: [false],
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
    expect(o.calls).toHaveLength(1);
    expect(textOf(o.calls[0])).toContain('already covered');
    expect(textOf(o.calls[0])).toContain(o.fx.a.root);
    expectNothingChanged(o);
  });
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
