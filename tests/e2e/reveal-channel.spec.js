'use strict';

/*
 * files:reveal channel e2e (Feature 2, Task 4). The app runs with the
 * shell.showItemInFolder stub from tests/support/background-main.js, which
 * records its argument; the real channel code (guard, index check, existence
 * check) runs unchanged.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { newUserDataDir, launchApp, revealCalls } = require('../support/e2e-app.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

test('files:reveal reveals an indexed file once and rejects an unindexed path without a call', async () => {
  const userDataDir = newUserDataDir('reveal-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-reveal-outside-'));
  const outsideFile = path.join(outsideDir, 'not-indexed.txt');
  const indexed = `${root}/top.mp3`;
  let session;
  try {
    fs.writeFileSync(outsideFile, 'x');
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Reveal', [root]);

    session = await launchApp(userDataDir);
    const { app, window } = session;

    expect(await revealCalls(app)).toEqual([]);

    const ok = await window.evaluate((p) => window.mediaOrganizer.revealFile(p), indexed);
    expect(ok).toMatchObject({ ok: true });
    expect(await revealCalls(app)).toEqual([indexed]);

    const rejected = await window.evaluate((p) => window.mediaOrganizer.revealFile(p), outsideFile);
    expect(rejected).toMatchObject({ ok: false, code: 'NOT_INDEXED' });
    expect(await revealCalls(app)).toEqual([indexed]);
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
