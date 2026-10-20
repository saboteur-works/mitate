'use strict';

/*
 * dialog.showMessageBox stub e2e (Feature 3, Task 14). The app runs with the
 * stub from tests/support/background-main.js: it records the options and answers
 * from the queue set by stubConfirm; the real dialog is never opened. The real
 * collections:delete channel and service run unchanged.
 */

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const {
  newUserDataDir, launchApp, stubFolderPicker, stubConfirm, confirmCalls,
} = require('../support/e2e-app.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const namesInStore = (userDataDir) =>
  openStorage({ location: { baseDir: userDataDir } }).listCollections().map((c) => c.name).sort();

test('stubConfirm answers delete confirmations, records them, defaults to cancel, and coexists with stubFolderPicker', async () => {
  const userDataDir = newUserDataDir('confirm-stub');
  const first = buildFixtureTree();
  const second = buildFixtureTree();
  let session;
  try {
    const service = createCollectionService({ storage: openStorage({ location: { baseDir: userDataDir } }) });
    await service.createCollection('Alpha', [first.root]);
    await service.createCollection('Beta', [second.root]);

    session = await launchApp(userDataDir);
    const { app, window } = session;
    const listed = await window.evaluate(() => window.mediaOrganizer.listCollections());
    const alpha = listed.summaries.find((s) => s.name === 'Alpha').id;
    const beta = listed.summaries.find((s) => s.name === 'Beta').id;
    const del = (id) => window.evaluate((i) => window.mediaOrganizer.deleteCollection(i), id);

    expect(await confirmCalls(app)).toEqual([]);

    // Cancel: nothing deleted, one recorded dialog with the expected options.
    await stubConfirm(app, [false]);
    expect(await del(alpha)).toEqual({ ok: true, canceled: true });
    const calls = await confirmCalls(app);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).toContain('Alpha');
    expect(JSON.stringify(calls[0]).toLowerCase()).toContain('no files on disk');
    expect(calls[0].buttons).toEqual(['Delete collection', 'Cancel']);

    // The store, read after closing, still has the cancelled collection.
    await session.app.close();
    session = null;
    expect(namesInStore(userDataDir)).toEqual(['Alpha', 'Beta']);

    // Relaunch on the same data (ids are unchanged); the recorded calls start empty again.
    session = await launchApp(userDataDir);
    const { app: app2, window: window2 } = session;
    const del2 = (id) => window2.evaluate((i) => window.mediaOrganizer.deleteCollection(i), id);
    expect(await confirmCalls(app2)).toEqual([]);

    // Confirm: deleted.
    await stubConfirm(app2, [true]);
    expect(await del2(alpha)).toEqual({ ok: true, deleted: true });
    expect(await confirmCalls(app2)).toHaveLength(1);

    // No queued answer: cancelled by default and recorded.
    expect(await del2(beta)).toEqual({ ok: true, canceled: true });
    expect(await confirmCalls(app2)).toHaveLength(2);

    // The picker stub still works alongside the message-box stub.
    const picker = await stubFolderPicker(app2, [first.root]);
    const picked = await window2.evaluate(() => window.mediaOrganizer.pickFolders());
    expect(picked).toEqual({ canceled: false, paths: [first.root] });
    expect(await picker.calls()).toBe(1);
    expect(await confirmCalls(app2)).toHaveLength(2);

    await session.app.close();
    session = null;
    expect(namesInStore(userDataDir)).toEqual(['Beta']);
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(first.root);
    cleanupFixtureTree(second.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
