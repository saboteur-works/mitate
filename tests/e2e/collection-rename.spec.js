'use strict';

/*
 * Rename in the management panel e2e (Feature 3, Task 16; FR-1, FR-13). Two collections are
 * written to <userDataDir>/store.json before launch with the real service + scanner. The store is
 * read from disk, so what is compared is what was persisted. A rename must change the name only:
 * the folders, the index and the tree stay as they were, and no confirmation dialog is shown.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, stubConfirm, confirmCalls } = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const rowPaths = (window) =>
  window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"]')].map((r) => r.dataset.path),
  );

const readStore = (userDataDir) => JSON.parse(fs.readFileSync(path.join(userDataDir, 'store.json'), 'utf8'));

// The store with every collection name blanked: what a rename must leave untouched.
function withoutNames(store) {
  const copy = JSON.parse(JSON.stringify(store));
  for (const c of Object.values(copy.collections)) delete c.name;
  return copy;
}

const namesOf = (store) => Object.values(store.collections).map((c) => c.name).sort();

const itemNamed = (window, name) =>
  window.getByTestId('collection-item').filter({ has: window.getByTestId('collection-name-label').getByText(name, { exact: true }) });

test('rename from the management panel: trimmed, immediate, persisted, nothing else changes', async () => {
  const userDataDir = newUserDataDir('rename-e2e');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    await service.createCollection('Alpha', [first.root]);
    await service.createCollection('Beta', [second.root]);
    const storeBefore = readStore(userDataDir);

    session = await launchApp(userDataDir);
    let { app, window } = session;
    const byId = (id) => window.getByTestId(id);

    // Before any selection the panel is hidden.
    await expect(byId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await expect(byId('manage-panel')).toBeHidden();

    // Selecting shows the name in the input.
    await itemNamed(window, 'Alpha').click();
    await expect(byId('tree-row').first()).toBeVisible({ timeout: 30000 });
    await expect(byId('manage-panel')).toBeVisible();
    await expect(byId('rename-input')).toHaveValue('Alpha');
    const rowsBefore = await rowPaths(window);
    expect(rowsBefore.length).toBeGreaterThan(0);

    // Empty and whitespace-only names are refused; the label and the store stay.
    for (const bad of ['', '   ']) {
      await byId('rename-input').fill(bad);
      await byId('rename-button').click();
      await expect(byId('manage-error')).toBeVisible();
      await expect(byId('manage-error')).toHaveAttribute('role', 'alert');
      await expect(byId('manage-error')).not.toHaveText('');
      await expect(itemNamed(window, 'Alpha')).toHaveCount(1);
      expect(readStore(userDataDir)).toEqual(storeBefore);
    }

    // Padded name: trimmed, label immediately, selection and tree unchanged, no dialog.
    await stubConfirm(app, []);
    await byId('rename-input').fill('  Holiday  ');
    await byId('rename-button').click();
    await expect(byId('collection-name-label').filter({ hasText: /^Holiday$/ })).toHaveCount(1, { timeout: 2000 });
    await expect(byId('manage-error')).toBeHidden();
    await expect(itemNamed(window, 'Holiday')).toHaveClass(/collection-selected/);
    expect(await rowPaths(window)).toEqual(rowsBefore);
    await expect(byId('rename-input')).toHaveValue('Holiday');

    // Renaming to the name the other collection has is accepted.
    await byId('rename-input').fill('Beta');
    await byId('rename-button').click();
    await expect(itemNamed(window, 'Beta')).toHaveCount(2);

    // A 300-character name is accepted and shown.
    const long = 'L'.repeat(300);
    await byId('rename-input').fill(long);
    await byId('rename-button').click();
    await expect(itemNamed(window, long)).toHaveCount(1);

    // Back to Holiday for the relaunch check.
    await byId('rename-input').fill('  Holiday  ');
    await byId('rename-button').click();
    await expect(itemNamed(window, 'Holiday')).toHaveCount(1);

    expect(await confirmCalls(app)).toEqual([]);
    const storeAfter = readStore(userDataDir);
    expect(withoutNames(storeAfter)).toEqual(withoutNames(storeBefore));
    expect(namesOf(storeAfter)).toEqual(['Beta', 'Holiday']);

    // Relaunch: the list shows the new name.
    await app.close();
    session = await launchApp(userDataDir);
    ({ app, window } = session);
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await expect(itemNamed(window, 'Holiday')).toHaveCount(1);
    await expect(itemNamed(window, 'Alpha')).toHaveCount(0);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(first.root);
    cleanupFixtureTree(second.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
