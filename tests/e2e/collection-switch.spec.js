'use strict';

/*
 * Switching the active collection e2e (Feature 3, Task 24; FR-5, FR-13). Two collections over two
 * different fixture folders are written to <userDataDir>/store.json before launch with the real
 * service + scanner (as in rescan.spec.js). Selecting a collection only reads the stored index:
 * the collections:rescan handler is counted with gateChannel (never held back: it is released
 * before any call could arrive) and the store file is compared byte for byte.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, rowAt, gateChannel } = require('../support/e2e-app.js');
const { CHANNELS } = require('../../src/main/ipc.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const rowPaths = (window) =>
  window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path),
  );

// Every rendered row is the folder itself or below it, and there is at least one row.
async function expectRowsOnlyUnder(window, own, other) {
  await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
  await expect(rowAt(window, own)).toHaveCount(1);
  const paths = await rowPaths(window);
  expect(paths.length).toBeGreaterThan(0);
  for (const p of paths) {
    expect(p === own || p.startsWith(`${own}/`), `${p} is under ${own}`).toBe(true);
    expect(p === other || p.startsWith(`${other}/`), `${p} is not under ${other}`).toBe(false);
  }
}

async function expectNothingSelected(window) {
  await expect(window.locator('[data-testid="tree-row"][aria-selected="true"]')).toHaveCount(0);
  await expect(window.getByTestId('file-path')).toHaveClass(/file-path-empty/);
  await expect(window.getByTestId('reveal')).toBeDisabled();
}

test('switching collections shows only the chosen files, carries no selection, scans nothing, and is not persisted', async () => {
  const userDataDir = newUserDataDir('switch-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  const rootA = first.root;
  const rootB = second.root;
  const fileA = `${rootA}/top.mp3`;
  const fileB = `${rootB}/top.mp3`;
  const storeFile = path.join(userDataDir, 'store.json');
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    await service.createCollection('Alpha', [rootA]);
    await service.createCollection('Beta', [rootB]);
    const storeBefore = fs.readFileSync(storeFile);

    session = await launchApp(userDataDir);
    let { app, window } = session;
    const gate = await gateChannel(app, CHANNELS.rescanCollection);
    await gate.release();
    const items = window.getByTestId('collection-item');
    const alpha = items.filter({ hasText: 'Alpha' });
    const beta = items.filter({ hasText: 'Beta' });
    const detailPath = window.getByTestId('file-path');

    // At launch nothing is selected and the tree is empty.
    await expect(items).toHaveCount(2, { timeout: 30000 });
    await expect(window.locator('.collection-selected')).toHaveCount(0);
    await expect(window.getByTestId('tree-row')).toHaveCount(0);

    // First collection: only its files.
    await alpha.click();
    await expect(alpha).toHaveClass(/collection-selected/, { timeout: 30000 });
    await expect(beta).not.toHaveClass(/collection-selected/);
    await rowAt(window, rootA).click();
    await expect(rowAt(window, fileA)).toHaveCount(1);
    await expectRowsOnlyUnder(window, rootA, rootB);
    await expect(rowAt(window, fileB)).toHaveCount(0);

    // Select a file in it.
    await rowAt(window, fileA).click();
    await expect(rowAt(window, fileA)).toHaveAttribute('aria-selected', 'true');
    await expect(detailPath).toHaveText(fileA);
    await expect(window.getByTestId('reveal')).toBeEnabled();

    // Second collection: only its files, and the selection does not carry over.
    await beta.click();
    await expect(beta).toHaveClass(/collection-selected/, { timeout: 30000 });
    await expect(alpha).not.toHaveClass(/collection-selected/);
    await expectRowsOnlyUnder(window, rootB, rootA);
    await expect(rowAt(window, fileA)).toHaveCount(0);
    await expectNothingSelected(window);
    await rowAt(window, rootB).click();
    await expect(rowAt(window, fileB)).toHaveCount(1);
    await expectRowsOnlyUnder(window, rootB, rootA);
    await expectNothingSelected(window);

    // Back to the first: its selection is not restored.
    await alpha.click();
    await expect(alpha).toHaveClass(/collection-selected/, { timeout: 30000 });
    await expectRowsOnlyUnder(window, rootA, rootB);
    await expectNothingSelected(window);
    await rowAt(window, rootA).click();
    await expect(rowAt(window, fileA)).toHaveCount(1);
    await expect(rowAt(window, fileA)).not.toHaveAttribute('aria-selected', 'true');
    await expectNothingSelected(window);

    // Switching scanned nothing and wrote nothing.
    expect(await gate.calls()).toBe(0);
    expect(fs.readFileSync(storeFile).equals(storeBefore)).toBe(true);

    // The active collection is not persisted: after relaunch none is selected.
    await session.app.close();
    session = null;
    session = await launchApp(userDataDir);
    window = session.window;
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await expect(window.locator('.collection-selected')).toHaveCount(0);
    await expect(window.getByTestId('tree-row')).toHaveCount(0);
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(rootA);
    cleanupFixtureTree(rootB);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
