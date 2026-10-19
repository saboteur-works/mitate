'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');

test('creates a collection from picked folders; picker is directory-only; empty name refused', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-e2e-'));
  const treeA = buildFixtureTree();
  const treeB = buildFixtureTree();
  const paths = [treeA.root, treeB.root];
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: path.join(__dirname, '..', '..'),
  });
  try {
    await app.evaluate(({ dialog }, folderPaths) => {
      dialog.showOpenDialog = async (...args) => {
        globalThis.__lastDialogOptions = args[args.length - 1];
        return { canceled: false, filePaths: folderPaths };
      };
    }, paths);

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    const byId = (id) => window.getByTestId(id);

    await expect(byId('collection-item')).toHaveCount(0);

    // Add folder lists both picked folders.
    await byId('add-folder').click();
    await expect(byId('folder-item')).toHaveCount(2);
    await expect(byId('folder-item').nth(0)).toHaveText(paths[0]);
    await expect(byId('folder-item').nth(1)).toHaveText(paths[1]);

    // Empty name is refused with a visible error and nothing is created.
    await byId('create-collection').click();
    await expect(byId('create-error')).toBeVisible();
    await expect(byId('collection-item')).toHaveCount(0);

    // A valid name creates the collection.
    await byId('collection-name').fill('My Media');
    await byId('create-collection').click();
    await expect(byId('collection-item')).toHaveCount(1);
    await expect(byId('collection-name-label')).toHaveText('My Media');
    await expect(byId('collection-folder-count')).toHaveText('2');
    await expect(byId('create-error')).toBeHidden();
    await expect(byId('folder-item')).toHaveCount(0);

    // The picker was opened for directories only.
    const options = await app.evaluate(() => globalThis.__lastDialogOptions);
    expect(options.properties).toContain('openDirectory');
    expect(options.properties).not.toContain('openFile');

    // The page offers no file input.
    await expect(window.locator('input[type="file"]')).toHaveCount(0);
  } finally {
    await app.close();
    cleanupFixtureTree(treeA.root);
    cleanupFixtureTree(treeB.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
