'use strict';

/*
 * Management controls while a scan of the collection runs (Feature 3, Task 23; FR-12, FR-13).
 *
 * Two holds are used, for two different things:
 *  - gateChannel stops a call before the main-process handler runs. The renderer has already marked
 *    the collection busy (it does so on the click), so it shows the disabled controls; the main
 *    process has not taken its in-flight guard yet.
 *  - holdNextScan (tests/support/scan-hold.js) holds the real scan inside the service, so the guard
 *    stays taken. That is what the main-process refusals (COLLECTION_BUSY, RESCAN_IN_PROGRESS) need.
 * The collections are written to <userDataDir>/store.json before launch with the real service.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, stubFolderPicker, gateChannel, confirmCalls,
} = require('../support/e2e-app.js');
const { holdNextScan } = require('../support/scan-hold.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { CHANNELS } = require('../../src/main/ipc.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const makeDir = (label) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `mitate-busy-${label}-`)));
  fs.writeFileSync(path.join(dir, `${label}.pdf`), `${label}\n`);
  return dir;
};

// Alpha has two folders (so Remove is offered), Beta one; `extra` is free to be added.
async function withApp(label, body) {
  const userDataDir = newUserDataDir(`busy-${label}`);
  const alpha = [buildFixtureTree(), buildFixtureTree()];
  const betaDir = makeDir('beta');
  const extra = makeDir('extra');
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    const a = await service.createCollection('Alpha', alpha.map((t) => t.root));
    const b = await service.createCollection('Beta', [betaDir]);
    session = await launchApp(userDataDir);
    const { app, window } = session;
    const items = window.getByTestId('collection-item');
    await expect(items).toHaveCount(2, { timeout: 30000 });
    const ui = {
      alphaItem: items.filter({ hasText: 'Alpha' }),
      betaItem: items.filter({ hasText: 'Beta' }),
    };
    await body({
      app, window, userDataDir, extra, alphaId: a.collection.id, betaId: b.collection.id, ui,
      alphaRoots: alpha.map((t) => t.root),
    });
  } finally {
    if (session) await session.app.close().catch(() => {});
    for (const t of alpha) cleanupFixtureTree(t.root);
    fs.rmSync(betaDir, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function selectItem(window, item, folderCount) {
  await item.click();
  await expect(item).toHaveClass(/collection-selected/, { timeout: 30000 });
  await expect(window.getByTestId('manage-folder')).toHaveCount(folderCount, { timeout: 30000 });
}

// The four management controls: rename (input and button), delete, add folder, every Remove.
async function expectControls(window, expectation) {
  const check = async (locator) => (expectation === 'disabled'
    ? expect(locator).toBeDisabled({ timeout: 30000 })
    : expect(locator).toBeEnabled({ timeout: 30000 }));
  await check(window.getByTestId('rename-button'));
  await check(window.getByTestId('rename-input'));
  await check(window.getByTestId('delete-collection-button'));
  await check(window.getByTestId('add-folder-button'));
  const removes = await window.getByTestId('remove-folder').all();
  expect(removes.length).toBeGreaterThan(0);
  for (const button of removes) await check(button);
}

// Calls a channel directly through the preload API, as the page could (the page's CSP forbids eval,
// so the method is named, not passed as a function).
const call = (window, method, ...args) =>
  window.evaluate(([name, params]) => window.mediaOrganizer[name](...params), [method, args]);

const readStore = (userDataDir) => fs.readFileSync(path.join(userDataDir, 'store.json'), 'utf8');

test('rescan held: all management controls and Rescan are disabled; another collection stays enabled', async () => {
  await withApp('rescan-ui', async ({ app, window, ui }) => {
    const gate = await gateChannel(app, CHANNELS.rescanCollection);
    await selectItem(window, ui.alphaItem, 2);
    await expectControls(window, 'enabled');
    await expect(window.getByTestId('rescan')).toBeEnabled();

    await window.getByTestId('rescan').click();
    await expect(window.getByTestId('rescan')).toBeDisabled();
    await expectControls(window, 'disabled');

    // The other collection has nothing running: its controls are enabled.
    await selectItem(window, ui.betaItem, 1);
    await expectControls(window, 'enabled');
    await expect(window.getByTestId('rescan')).toBeEnabled();

    // Back to the busy one: disabled again.
    await selectItem(window, ui.alphaItem, 2);
    await expectControls(window, 'disabled');

    await gate.release();
    await expect(window.getByTestId('rescan-status')).toContainText('Rescanned', { timeout: 30000 });
    await expectControls(window, 'enabled');
    await expect(window.getByTestId('rescan')).toBeEnabled();
  });
});

test('add folder held: the same controls are disabled, then re-enabled on release', async () => {
  await withApp('add-ui', async ({ app, window, ui, extra }) => {
    await stubFolderPicker(app, [extra]);
    const gate = await gateChannel(app, CHANNELS.addFolders);
    await selectItem(window, ui.alphaItem, 2);

    await window.getByTestId('add-folder-button').click();
    await expect.poll(() => gate.calls(), { timeout: 30000 }).toBe(1);
    await expectControls(window, 'disabled');
    await expect(window.getByTestId('rescan')).toBeDisabled();

    await gate.release();
    await expect(window.getByTestId('manage-folder')).toHaveCount(3, { timeout: 30000 });
    await expectControls(window, 'enabled');
    await expect(window.getByTestId('rescan')).toBeEnabled();
  });
});

test('rescan held in the service: the four management channels are refused with COLLECTION_BUSY', async () => {
  await withApp('refuse', async ({ app, window, ui, userDataDir, alphaId, extra }) => {
    const storeBefore = readStore(userDataDir);
    const hold = await holdNextScan(app);
    await selectItem(window, ui.alphaItem, 2);
    const folderId = await window.getByTestId('manage-folder').first().getAttribute('data-folder-id');

    await window.getByTestId('rescan').click();
    await expect.poll(() => hold.started(), { timeout: 30000 }).toBe(true);
    await expectControls(window, 'disabled');

    const refusals = [
      await call(window, 'renameCollection', alphaId, 'Renamed'),
      await call(window, 'deleteCollection', alphaId),
      await call(window, 'addFolders', alphaId, [extra]),
      await call(window, 'removeFolder', alphaId, folderId),
    ];
    for (const result of refusals) {
      expect(result.ok).toBe(false);
      expect(result.code).toBe('COLLECTION_BUSY');
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
    expect(await confirmCalls(app)).toEqual([]);

    // A second rescan of the same collection is the in-progress refusal.
    const second = await call(window, 'rescanCollection', alphaId);
    expect(second.ok).toBe(false);
    expect(second.code).toBe('RESCAN_IN_PROGRESS');

    // The scan never finished and nothing was written.
    await app.close();
    expect(readStore(userDataDir)).toBe(storeBefore);
  });
});

test('add folder held in the service: a rescan of that collection is refused with COLLECTION_BUSY', async () => {
  await withApp('refuse-rescan', async ({ app, window, ui, alphaId, extra }) => {
    const hold = await holdNextScan(app);
    await stubFolderPicker(app, [extra]);
    await selectItem(window, ui.alphaItem, 2);

    await window.getByTestId('add-folder-button').click();
    await expect.poll(() => hold.started(), { timeout: 30000 }).toBe(true);
    await expectControls(window, 'disabled');

    // Re-selecting the collection while its add-folder scan is held: Rescan stays disabled and
    // does not claim a rescan is running.
    await selectItem(window, ui.alphaItem, 2);
    await expect(window.getByTestId('rescan')).toBeDisabled();
    await expect(window.getByTestId('rescan-status')).not.toHaveText('Rescanning...');
    await expect(window.getByTestId('rescan-status')).toHaveText('');

    const refused = await call(window, 'rescanCollection', alphaId);
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('COLLECTION_BUSY');
    expect(typeof refused.error).toBe('string');

    await hold.release();
    await expect(window.getByTestId('manage-folder')).toHaveCount(3, { timeout: 30000 });
    await expectControls(window, 'enabled');
  });
});

test('a rescan of a different collection is not blocked while one is held', async () => {
  await withApp('other', async ({ app, window, ui, betaId }) => {
    const hold = await holdNextScan(app);
    await selectItem(window, ui.alphaItem, 2);
    await window.getByTestId('rescan').click();
    await expect.poll(() => hold.started(), { timeout: 30000 }).toBe(true);

    const other = await call(window, 'rescanCollection', betaId);
    expect(other.ok).toBe(true);

    await hold.release();
    await expect(window.getByTestId('rescan-status')).toContainText('Rescanned', { timeout: 30000 });
    await expectControls(window, 'enabled');
  });
});
