'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');

// Why the main-process handler is slowed rather than window.mediaOrganizer.createCollection:
// the object comes from contextBridge, so the page cannot reliably replace its members (and
// the renderer holds its own reference). Instead the test wraps the already-registered
// 'collections:create' handler through ipcMain._invokeHandlers (Electron internal Map of
// channel -> handler; the test fails loudly if it is absent) so each call counts itself and
// waits on a gate the test releases. No production code carries a test hook.
test('Create is disabled while a collection is being created; double-click creates one', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-e2e-'));
  const tree = buildFixtureTree();
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: path.join(__dirname, '..', '..'),
  });
  try {
    await app.evaluate(({ dialog, ipcMain }, folderPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folderPath] });
      const handlers = ipcMain._invokeHandlers;
      const original = handlers && handlers.get && handlers.get('collections:create');
      if (typeof original !== 'function') {
        throw new Error('ipcMain._invokeHandlers has no collections:create handler');
      }
      globalThis.__createCalls = 0;
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      globalThis.__releaseCreate = release;
      handlers.set('collections:create', async (...args) => {
        globalThis.__createCalls += 1;
        await gate;
        return original(...args);
      });
    }, tree.root);

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    const byId = (id) => window.getByTestId(id);
    const createCalls = () => app.evaluate(() => globalThis.__createCalls);

    await byId('add-folder').click();
    await expect(byId('folder-item')).toHaveCount(1);
    await byId('collection-name').fill('Once Only');

    await byId('create-collection').dblclick();

    // Pending: the button is disabled and exactly one call reached the main process.
    await expect(byId('create-collection')).toBeDisabled();
    await expect.poll(createCalls).toBeGreaterThanOrEqual(1);
    await window.waitForTimeout(300);
    expect(await createCalls()).toBe(1);
    await expect(byId('create-collection')).toBeDisabled();
    await expect(byId('collection-item')).toHaveCount(0);

    // Release the pending call: one collection, button usable again.
    await app.evaluate(() => globalThis.__releaseCreate());
    await expect(byId('collection-item')).toHaveCount(1);
    await expect(byId('create-collection')).toBeEnabled();
    await expect(byId('collection-name-label')).toHaveText('Once Only');
    expect(await createCalls()).toBe(1);

    // The store agrees: exactly one collection exists.
    const listed = await window.evaluate(() => window.mediaOrganizer.listCollections());
    expect(listed.ok).toBe(true);
    expect(listed.views).toHaveLength(1);
  } finally {
    await app.close();
    cleanupFixtureTree(tree.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

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
