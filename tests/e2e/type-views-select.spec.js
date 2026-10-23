'use strict';

/*
 * Selection, detail and Reveal from the type lists e2e (Feature 4, Task 12; FR-5, FR-7, FR-11,
 * FR-13). Collections are written to <userDataDir>/store.json before launch. type-views-wiring.spec.js
 * already covers that a view switch clears the selection (tree to list, list to list, list back to
 * the tree), and list-view-select.spec.js covers the keyboard model of the list on generated rows;
 * this spec adds what the detail area and Reveal do with a selection made in each real list, the
 * reveal error of an unavailable file, and the selection after a rescan and a collection change.
 * shell.showItemInFolder is the recording stub from tests/support/background-main.js.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, selectOnlyCollection, revealCalls, resetRevealCalls,
} = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const {
  KINDS, REL, addMedia, listRows, openList, seedCollection, selectCollection, expectNothingSelected,
} = require('../support/type-views-ui.js');

const rowAtIndex = (window, i) => window.locator(`[data-testid="list-row"][data-index="${i}"]`);
const selectedRows = (window) => window.locator('[data-testid="list-row"][aria-selected="true"]');
const rowAtPath = (window, p) => window.locator(`[data-testid="list-row"][data-path="${p}"]`);

// The detail area shows `file` and Reveal is enabled; pressing it records exactly that path.
async function expectRevealOf(app, window, file) {
  await expect(window.getByTestId('file-path')).toHaveText(file);
  await expect(window.getByTestId('reveal')).toBeEnabled();
  await resetRevealCalls(app);
  await window.getByTestId('reveal').click();
  await expect.poll(() => revealCalls(app)).toEqual([file]);
  await expect(window.getByTestId('reveal-error')).toBeHidden();
}

test('in each list a click, Enter and Space select a file, show its path and enable Reveal for that file', async () => {
  const userDataDir = newUserDataDir('type-select-lists-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  let session;
  try {
    addMedia(root);
    await seedCollection(userDataDir, 'Media', [root]);
    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    const list = window.getByTestId('list-view');

    for (const kind of KINDS) {
      await openList(window, kind, REL[kind].length);
      const rows = await listRows(window);
      await expectNothingSelected(window);

      // Click: that row only, with its full path in the detail area.
      await rowAtIndex(window, 0).click();
      await expect(rowAtIndex(window, 0)).toHaveAttribute('aria-selected', 'true');
      await expect(selectedRows(window)).toHaveCount(1);
      await expectRevealOf(app, window, rows[0].path);
      expect(await revealCalls(app)).toEqual([rows[0].path]);

      // ArrowDown moves focus without selecting; Enter selects the focused row.
      await list.focus();
      await window.keyboard.press('ArrowDown');
      await expect(list).toHaveAttribute('aria-activedescendant', 'list-row-1');
      await expect(rowAtIndex(window, 0)).toHaveAttribute('aria-selected', 'true');
      await window.keyboard.press('Enter');
      await expect(rowAtIndex(window, 1)).toHaveAttribute('aria-selected', 'true');
      await expect(selectedRows(window)).toHaveCount(1);
      await expectRevealOf(app, window, rows[1].path);

      // ArrowUp then Space selects the first row again.
      await list.focus();
      await window.keyboard.press('ArrowUp');
      await expect(list).toHaveAttribute('aria-activedescendant', 'list-row-0');
      await window.keyboard.press('Space');
      await expect(rowAtIndex(window, 0)).toHaveAttribute('aria-selected', 'true');
      await expect(selectedRows(window)).toHaveCount(1);
      await expectRevealOf(app, window, rows[0].path);
    }
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('an unavailable file is selectable in a list and Reveal fails as it does in the tree', async () => {
  const userDataDir = newUserDataDir('type-select-unavail-e2e');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-type-select-unavail-'));
  const folder = path.join(base, 'vanishing');
  const file = `${folder}/a.jpg`;
  let session;
  try {
    fs.mkdirSync(folder);
    fs.writeFileSync(file, 'unavailable case\n');
    await seedCollection(userDataDir, 'Vanishing', [folder]);
    fs.rmSync(folder, { recursive: true, force: true });

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    await openList(window, 'image', 1);
    await expect(rowAtPath(window, file).getByTestId('unavailable')).toHaveText('unavailable');

    await rowAtPath(window, file).click();
    await expect(rowAtPath(window, file)).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('file-path')).toHaveText(file);
    await expect(window.getByTestId('reveal')).toBeEnabled();

    // The same outcome as the tree's (reveal-errors.spec.js): a role=alert text with the path and
    // "File not found", nothing revealed, no rescan offered, the row still selected.
    await window.getByTestId('reveal').click();
    const error = window.getByTestId('reveal-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('role', 'alert');
    const text = await error.textContent();
    expect(text).toContain(file);
    expect(text).toContain('File not found');
    expect(await revealCalls(app)).toEqual([]);
    await expect(error.locator('button, a, input, [role="button"]')).toHaveCount(0);
    await expect(rowAtPath(window, file)).toHaveAttribute('aria-selected', 'true');
    await expect(rowAtPath(window, file).getByTestId('unavailable')).toHaveText('unavailable');
    await expect(window.getByTestId('file-path')).toHaveText(file);

    // Selecting another file would clear the error; here a view switch clears both.
    await window.getByTestId('view-tab-audio').click();
    await expect(window.getByTestId('reveal-error')).toBeHidden();
  } finally {
    if (session) await session.app.close().catch(() => {});
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a rescan keeps the selection of a file still present, clears that of a deleted one; another collection clears it', async () => {
  const userDataDir = newUserDataDir('type-select-rescan-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-type-select-other-'));
  let session;
  try {
    addMedia(root);
    fs.writeFileSync(path.join(other, 'other.jpg'), 'x\n');
    await seedCollection(userDataDir, 'Media', [root]);
    await seedCollection(userDataDir, 'Other', [other]);
    session = await launchApp(userDataDir);
    const { app, window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await selectCollection(window, 'Media');
    await openList(window, 'image', REL.image.length);
    const keep = `${root}/Photos/img2.jpg`;
    const doomed = `${root}/Photos/2024/b.png`;

    // File still present: the selection, the detail and Reveal survive the rescan.
    await rowAtPath(window, keep).click();
    await expect(rowAtPath(window, keep)).toHaveAttribute('aria-selected', 'true');
    await window.evaluate(() => {
      window.__selected = [];
      document.addEventListener('file-selected', (e) => window.__selected.push(e.detail));
    });
    await window.getByTestId('rescan').click();
    await expect(window.getByTestId('rescan-status')).toHaveText(/^Rescanned/, { timeout: 30000 });
    await expect(window.getByTestId('rescan')).toBeEnabled();
    await expect(rowAtPath(window, keep)).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
    expect(await window.evaluate(() => window.__selected)).toEqual([]);
    await expectRevealOf(app, window, keep);

    // File deleted on disk before the rescan: the row is gone and the selection is cleared.
    await rowAtPath(window, doomed).click();
    await expect(window.getByTestId('file-path')).toHaveText(doomed);
    fs.rmSync(doomed);
    await window.getByTestId('rescan').click();
    await expect(rowAtPath(window, doomed)).toHaveCount(0, { timeout: 30000 });
    await expect(window.getByTestId('rescan')).toBeEnabled();
    await expectNothingSelected(window);
    expect((await window.evaluate(() => window.__selected)).at(-1)).toEqual({ file: null });

    // Selecting another collection clears the selection.
    await rowAtPath(window, keep).click();
    await expect(window.getByTestId('file-path')).toHaveText(keep);
    await selectCollection(window, 'Other');
    await expect(window.getByTestId('list-row')).toHaveCount(1);
    await expect(rowAtPath(window, `${other}/other.jpg`)).toBeVisible();
    await expectNothingSelected(window);
    expect((await window.evaluate(() => window.__selected)).at(-1)).toEqual({ file: null });
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(other, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
