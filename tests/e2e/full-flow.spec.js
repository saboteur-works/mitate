'use strict';

/*
 * Full flow under the read-only check (Task 16; FR-17, FR-13, FR-3).
 *
 * Fixture tree (xattrs, symlinks, package bundle) -> read-only snapshot 'before'
 * -> launch, create a collection through the UI, browse the tree, quit ->
 * relaunch with the same --user-data-dir: the collection and tree reappear and
 * the folder picker is never invoked -> snapshot 'after' -> assert no non-atime
 * differences. Access-time differences never fail the test; they are attached
 * to the test output and logged.
 *
 * The user data dir is created under os.tmpdir() as a sibling of the fixture
 * root, never inside it (FR-13); the test asserts that.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, rowAt, stubFolderPicker } = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const readonlyCheck = require('../../tools/readonly-check/index.js');

// Launches the app with the folder picker stubbed to return pickPaths and count its calls.
async function launch(userDataDir, pickPaths) {
  const session = await launchApp(userDataDir);
  return { ...session, picker: await stubFolderPicker(session.app, pickPaths) };
}

// atimeNs may be a BigInt, which JSON.stringify cannot serialize.
const toJson = (value) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

async function browse(window, root) {
  await rowAt(window, root).click();
  for (const rel of ['Photos', 'Photos/2024', 'Photos/2024/Trip', 'Photos/2024/Trip/Day1']) {
    await rowAt(window, `${root}/${rel}`).click();
  }
  await expect(rowAt(window, `${root}/Photos/2024/Trip/Day1/deep.jpg`)).toContainText('deep.jpg');
  await expect(rowAt(window, `${root}/Photos/2024/Trip/c.heic`)).toContainText('c.heic');
}

test('create, browse, quit and relaunch leave the fixture tree unchanged and need no folder picker on relaunch', async () => {
  test.setTimeout(120000);
  const userDataDir = newUserDataDir('fullflow-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  let session;
  try {
    // FR-13: app storage lives outside the fixture root.
    expect(path.relative(fs.realpathSync(root), fs.realpathSync(userDataDir)).startsWith('..')).toBe(true);

    const before = readonlyCheck.snapshot(root, { role: 'before' });

    // Session 1: create through the UI and browse.
    session = await launch(userDataDir, [root]);
    let { app, window, picker } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(0);
    await window.getByTestId('add-folder').click();
    await expect(window.getByTestId('folder-item')).toHaveCount(1);
    await expect(window.getByTestId('folder-item')).toHaveText(root);
    await window.getByTestId('collection-name').fill('Full flow');
    await window.getByTestId('create-collection').click();
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 60000 });
    await expect(window.getByTestId('collection-name-label')).toHaveText('Full flow');
    expect(await picker.calls()).toBe(1);
    await window.getByTestId('collection-item').click();
    await expect(rowAt(window, root)).toHaveCount(1, { timeout: 30000 });
    await browse(window, root);
    await app.close();
    session = null;

    // Session 2: same user data dir; stored collection and tree, no picker.
    session = await launch(userDataDir, [root]);
    ({ app, window, picker } = session);
    await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
    await expect(window.getByTestId('collection-name-label')).toHaveText('Full flow');
    await expect(window.getByTestId('folder-item')).toHaveCount(0);
    await window.getByTestId('collection-item').click();
    await expect(rowAt(window, root)).toHaveCount(1, { timeout: 30000 });
    await browse(window, root);
    await expect(window.getByTestId('unavailable')).toHaveCount(0);
    // The picker stub counter is per launch: 0 means Add folder was never invoked.
    expect(await picker.calls()).toBe(0);
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
