'use strict';

/*
 * Read-only check around the type views (Feature 4, Task 16; FR-12, US-4), following
 * management-readonly.spec.js. Fixture tree (with media of all four kinds added) -> collection over
 * it through the service -> read-only snapshot 'before' (app closed) -> launch, select the
 * collection, open Tree, Images, Audio, Video and Documents in turn, scroll each list to the end
 * and back, select a file in each by click and by keyboard, press Reveal in Finder once per list
 * (the recording stub from tests/support/background-main.js, no Finder window opens), switch back
 * to Tree, quit -> snapshot 'after' (app closed) -> assert no non-atime differences. Access-time
 * differences never fail the test; they are attached to the test output and logged. The flow also
 * checks that each step ran, so an idle flow cannot pass.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, revealCalls } = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const {
  REL, addMedia, listRows, openList, seedCollection, selectCollection,
} = require('../support/type-views-ui.js');
const readonlyCheck = require('../../tools/readonly-check/index.js');

// atimeNs may be a BigInt, which JSON.stringify cannot serialize.
const toJson = (value) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

const LISTS = [
  ['image', 'Images'],
  ['audio', 'Audio'],
  ['video', 'Video'],
  ['document', 'Documents'],
];

test('opening Tree, Images, Audio, Video and Documents, scrolling, selecting and revealing leave the fixture tree unchanged', async () => {
  test.setTimeout(180000);
  const userDataDir = newUserDataDir('type-views-readonly');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  let session;
  try {
    // App storage lives outside the fixture root.
    expect(path.relative(fs.realpathSync(root), fs.realpathSync(userDataDir)).startsWith('..')).toBe(true);
    addMedia(root);
    await seedCollection(userDataDir, 'Views', [root]);

    // Snapshot with the app closed (ordering rule in tools/readonly-check).
    const before = readonlyCheck.snapshot(root, { role: 'before' });

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectCollection(window, 'Views');
    const list = window.getByTestId('list-view');
    const ran = [];

    await window.getByTestId('view-tab-tree').click();
    await expect(window.getByTestId('tree-view')).toBeVisible();
    await expect(window.getByTestId('tree-row').first()).toBeVisible();

    for (const [kind, label] of LISTS) {
      await window.getByTestId(`view-tab-${kind}`).click();
      await expect(window.getByTestId(`view-tab-${kind}`)).toHaveText(label);
      await openList(window, kind, REL[kind].length);
      const rows = await listRows(window);
      expect(rows.length).toBeGreaterThanOrEqual(2);

      // Scroll to the end and back, with the keys and with the scrollbar position.
      await list.focus();
      await window.keyboard.press('End');
      await expect(list).toHaveAttribute('aria-activedescendant', `list-row-${rows.length - 1}`);
      await window.keyboard.press('Home');
      await expect(list).toHaveAttribute('aria-activedescendant', 'list-row-0');
      await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await list.evaluate((el) => { el.scrollTop = 0; });

      // Select by click, then by keyboard, and press Reveal for the keyboard selection.
      await window.locator('[data-testid="list-row"][data-index="0"]').click();
      await expect(window.getByTestId('file-path')).toHaveText(rows[0].path);
      await list.focus();
      await window.keyboard.press('ArrowDown');
      await window.keyboard.press('Enter');
      await expect(window.locator('[data-testid="list-row"][aria-selected="true"]')).toHaveCount(1);
      await expect(window.getByTestId('file-path')).toHaveText(rows[1].path);
      await expect(window.getByTestId('reveal')).toBeEnabled();
      await window.getByTestId('reveal').click();
      await expect.poll(async () => (await revealCalls(app)).length).toBe(ran.length + 1);
      ran.push(rows[1].path);
    }

    await window.getByTestId('view-tab-tree').click();
    await expect(window.getByTestId('tree-view')).toBeVisible();
    expect(await revealCalls(app)).toEqual(ran);
    expect(ran).toHaveLength(4);

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
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
