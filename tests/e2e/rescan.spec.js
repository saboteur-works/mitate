'use strict';

/*
 * Rescan e2e (Task 15, FR-20). The collection is created before launch with the
 * real service + real scanner into <userDataDir>/store.json, which the app reads
 * because --user-data-dir makes userData the temp dir.
 *
 * "No scan on launch" is checked by observation, not by instrumenting the app:
 * a file added on disk while the app is closed (after the rescan was stored)
 * must NOT be in the tree after relaunch, whereas the files from the earlier
 * rescan are. A scan on launch would have picked the late file up.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { APP_ENTRY } = require('../support/app-entry.js');
const { wrapHandler } = require('../support/ipc-wrap.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

async function launch(userDataDir) {
  const app = await electron.launch({
    args: [APP_ENTRY, `--user-data-dir=${userDataDir}`],
    cwd: path.join(__dirname, '..', '..'),
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

const rowAt = (window, p) => window.locator(`[data-testid="tree-row"][data-path="${p}"]`);

async function selectCollection(window) {
  await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
  await window.getByTestId('collection-item').click();
  await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
}

test('rescan is user-triggered, picks up added and removed files, and relaunch shows the stored tree without scanning', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-rescan-e2e-'));
  const fixture = buildFixtureTree();
  const root = fixture.root;
  const docs = `${root}/Docs`;
  const report = `${docs}/report.pdf`;
  const added = `${docs}/added.pdf`;
  const late = `${docs}/late.pdf`;
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Rescan', [root]);

    session = await launch(userDataDir);
    let { window } = session;
    await selectCollection(window);
    await expect(window.getByTestId('rescan')).toBeEnabled();
    await rowAt(window, root).click();
    await rowAt(window, docs).click();
    await expect(rowAt(window, report)).toContainText('report.pdf');

    // Change the disk after launch: add one supported file, delete another.
    fs.writeFileSync(added, 'added after launch\n');
    fs.rmSync(path.join(docs, 'report.pdf'));

    // Selecting the collection again reads the stored index; no scan has happened.
    await window.getByTestId('collection-item').click();
    await rowAt(window, root).click();
    await rowAt(window, docs).click();
    await expect(rowAt(window, report)).toContainText('report.pdf');
    await expect(rowAt(window, added)).toHaveCount(0);

    // Rescan: the tree updates and keeps the expanded folders.
    await window.getByTestId('rescan').click();
    await expect(rowAt(window, added)).toContainText('added.pdf');
    await expect(rowAt(window, report)).toHaveCount(0);
    await expect(rowAt(window, docs)).toHaveAttribute('data-expanded', 'true');
    await expect(window.getByTestId('rescan-status')).toContainText('Rescanned 1 folders');
    await expect(window.getByTestId('unavailable')).toHaveCount(0);

    // Quit, change the disk again while the app is closed, relaunch.
    await session.app.close();
    session = null;
    fs.writeFileSync(late, 'added while the app was closed\n');

    session = await launch(userDataDir);
    window = session.window;
    await selectCollection(window);
    await rowAt(window, root).click();
    await rowAt(window, docs).click();
    // The stored (rescanned) state is shown, and the late file is not: no scan ran.
    await expect(rowAt(window, added)).toContainText('added.pdf');
    await expect(rowAt(window, report)).toHaveCount(0);
    await expect(rowAt(window, late)).toHaveCount(0);

    // A new Rescan does pick the late file up.
    await window.getByTestId('rescan').click();
    await expect(rowAt(window, late)).toContainText('late.pdf');
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// The rescan is held in flight by wrapping the main-process 'collections:rescan' handler
// (tests/support/ipc-wrap.js) with a gate the test releases; no production code carries a
// test hook. The preload object is a frozen contextBridge object, so the renderer API is
// not wrapped. The wrapper is installed after the window has loaded (IPC is registered).
test('Rescan stays disabled for a collection whose rescan is running, even after selecting another collection and back', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-rescan-busy-e2e-'));
  const fixture = buildFixtureTree();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-rescan-busy-other-'));
  fs.writeFileSync(path.join(other, 'b.pdf'), 'b\n');
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    await service.createCollection('Alpha', [fixture.root]);
    await service.createCollection('Beta', [other]);

    session = await launch(userDataDir);
    const { app, window } = session;
    await wrapHandler(app, 'collections:rescan', (original) => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      globalThis.__releaseRescan = release;
      return async (event, ...args) => {
        await gate;
        return original(event, ...args);
      };
    });
    const items = window.getByTestId('collection-item');
    const alpha = items.filter({ hasText: 'Alpha' });
    const beta = items.filter({ hasText: 'Beta' });
    const rescan = window.getByTestId('rescan');
    await expect(items).toHaveCount(2, { timeout: 30000 });

    await alpha.click();
    await expect(alpha).toHaveClass(/collection-selected/, { timeout: 30000 });
    await expect(rescan).toBeEnabled();
    await rescan.click();
    await expect(rescan).toBeDisabled();

    // Another collection has no rescan running: Rescan is enabled for it.
    await beta.click();
    await expect(beta).toHaveClass(/collection-selected/, { timeout: 30000 });
    await expect(rescan).toBeEnabled();

    // Back to the collection whose rescan is still running: disabled again.
    await alpha.click();
    await expect(alpha).toHaveClass(/collection-selected/, { timeout: 30000 });
    await expect(rescan).toBeDisabled();
    await expect(window.getByTestId('rescan-status')).toHaveText('Rescanning...');

    // It re-enables only once the rescan has finished.
    await app.evaluate(() => globalThis.__releaseRescan());
    await expect(window.getByTestId('rescan-status')).toContainText('Rescanned 1 folders', { timeout: 30000 });
    await expect(rescan).toBeEnabled();
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(fixture.root);
    fs.rmSync(other, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
