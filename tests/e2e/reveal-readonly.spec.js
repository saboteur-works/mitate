'use strict';

/*
 * Read-only check around select and reveal (Feature 2, Task 13; FR-13, US-2).
 *
 * Fixture tree -> collection created through the service -> read-only snapshot 'before' (app
 * closed) -> launch, select several files by mouse and by keyboard, activate the stubbed Reveal
 * for each, quit -> snapshot 'after' (app closed) -> assert no non-atime differences. Access-time
 * differences never fail the test; they are attached to the test output and logged.
 * shell.showItemInFolder is the recording stub from tests/support/background-main.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, rowAt, selectOnlyCollection, revealCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');
const readonlyCheck = require('../../tools/readonly-check/index.js');

// atimeNs may be a BigInt, which JSON.stringify cannot serialize.
const toJson = (value) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

const revealBtn = (window) => window.getByTestId('reveal');
const rowIndex = async (window, p) => Number(await rowAt(window, p).getAttribute('data-index'));
const focusedPath = (window) =>
  window.evaluate(() => {
    const id = document.querySelector('[data-testid="tree-view"]').getAttribute('aria-activedescendant');
    const el = id ? document.getElementById(id) : null;
    return el ? el.dataset.path : null;
  });

async function press(window, key, times = 1) {
  for (let i = 0; i < times; i++) await window.keyboard.press(key);
}

// Presses Tab from the document start until the tree is the active element; -1 if not reached.
async function tabToTree(window, limit = 40) {
  await window.evaluate(() => {
    document.activeElement && document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  const isTree = () => window.evaluate(() => document.activeElement === document.querySelector('[data-testid="tree-view"]'));
  for (let n = 1; n <= limit; n++) {
    await window.keyboard.press('Tab');
    if (await isTree()) return n;
  }
  return -1;
}

// Mouse: click the file row, then click Reveal; waits for the stub to record the call.
async function revealByMouse(app, window, target, expectedCalls) {
  await rowAt(window, target).click();
  await expect(rowAt(window, target)).toHaveAttribute('aria-selected', 'true');
  await expect(revealBtn(window)).toBeEnabled();
  await revealBtn(window).click();
  await expect.poll(() => revealCalls(app)).toEqual(expectedCalls);
  await expect(revealBtn(window)).toBeEnabled();
}

// Keyboard: Tab to the tree, move to the top row, ArrowDown to the file, Enter to select,
// Tab to Reveal, Space to activate; waits for the stub to record the call.
async function revealByKeyboard(app, window, target, expectedCalls) {
  expect(await tabToTree(window)).toBeGreaterThan(0);
  await expect(window.getByTestId('tree-view')).toBeFocused();
  await press(window, 'ArrowUp', 40);
  await press(window, 'ArrowDown', await rowIndex(window, target));
  expect(await focusedPath(window)).toBe(target);
  await press(window, 'Enter');
  await expect(rowAt(window, target)).toHaveAttribute('aria-selected', 'true');
  await window.keyboard.press('Tab');
  await expect(revealBtn(window)).toBeFocused();
  await window.keyboard.press('Space');
  await expect.poll(() => revealCalls(app)).toEqual(expectedCalls);
  await expect(revealBtn(window)).toBeEnabled();
}

test('selecting files by mouse and keyboard and activating the stubbed Reveal leaves the fixture tree unchanged', async () => {
  test.setTimeout(120000);
  const userDataDir = newUserDataDir('reveal-readonly');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  let session;
  try {
    // FR-13: app storage lives outside the fixture root.
    expect(path.relative(fs.realpathSync(root), fs.realpathSync(userDataDir)).startsWith('..')).toBe(true);

    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Reveal readonly', [root]);

    // Snapshot with the app closed (ordering rule in tools/readonly-check).
    const before = readonlyCheck.snapshot(root, { role: 'before' });

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    expect(await revealCalls(app)).toEqual([]);

    // Expand the folders holding the files used below.
    await rowAt(window, root).click();
    for (const rel of ['Photos', 'Photos/2024', 'Docs', 'Music', 'Music/Album']) {
      await rowAt(window, `${root}/${rel}`).click();
    }

    const mouseFiles = ['top.mp3', 'Photos/2024/b.png', 'Photos/A.JPG'].map((rel) => `${root}/${rel}`);
    const keyFiles = ['Docs/report.pdf', 'Music/Album/track01.flac'].map((rel) => `${root}/${rel}`);
    const expected = [];
    for (const target of mouseFiles) {
      expected.push(target);
      await revealByMouse(app, window, target, [...expected]);
    }
    for (const target of keyFiles) {
      expected.push(target);
      await revealByKeyboard(app, window, target, [...expected]);
    }
    expect(await revealCalls(app)).toEqual([...mouseFiles, ...keyFiles]);

    await app.close();
    session = null;

    const after = readonlyCheck.snapshot(root, { role: 'after' });
    const atime = readonlyCheck.compare(before, after).atime;
    const report = toJson({ root, atimeDifferenceCount: atime.length, atime });
    await test.info().attach('atime-report.json', { body: report, contentType: 'application/json' });
    console.log(`read-only check atime report: ${report}`);

    // Throws on any non-atime difference; atime differences never fail (failOnAtime false).
    readonlyCheck.assert(before, after, { failOnAtime: false });
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
