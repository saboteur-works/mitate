'use strict';

/*
 * Large list virtualization e2e (Feature 4, Task 13; FR-3, FR-6, FR-13). A fixture of 10,000
 * generated files (tests/support/large-fixture.js) becomes a collection through the UI (folder
 * picker stubbed); the lists are opened and measured in the DOM. The expected first, middle and
 * last rows are computed here from the files on disk, by TreeModel.compareNames then absolute path.
 * No time threshold is asserted (product FR-20); the time to first render is only recorded.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, stubFolderPicker } = require('../support/e2e-app.js');
const { buildLargeFixture, cleanupLargeFixture } = require('../support/large-fixture.js');
const TreeModel = require('../../src/shared/tree-model.js');
const { KINDS, listRows } = require('../support/type-views-ui.js');

const ROW_HEIGHT = 24;
const BOUND_EXTRA = 11; // 2 * buffer + 1 partial row on top of the viewport rows
const EXT_KIND = {
  jpg: 'image', png: 'image', cr2: 'image', mp3: 'audio', flac: 'audio',
  mp4: 'video', mov: 'video', pdf: 'document', txt: 'document',
};

test.describe.configure({ mode: 'serial' });

let fixture;
let userDataDir;
let session;
const sorted = {};

test.beforeAll(() => {
  fixture = buildLargeFixture({ files: 10000 });
  userDataDir = newUserDataDir('type-large-e2e');
  // The files of each kind on disk, in list order.
  const byKind = { image: [], audio: [], video: [], document: [] };
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const kind = EXT_KIND[path.extname(entry.name).slice(1).toLowerCase()];
        if (kind) byKind[kind].push({ name: entry.name, path: full });
      }
    }
  };
  walk(fixture.root);
  for (const kind of KINDS) {
    sorted[kind] = byKind[kind].sort(
      (a, b) => TreeModel.compareNames(a.name, b.name) || (a.path === b.path ? 0 : a.path < b.path ? -1 : 1),
    );
  }
});

test.afterAll(async () => {
  if (session) await session.app.close().catch(() => {});
  if (fixture) cleanupLargeFixture(fixture.root);
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
});

// Number of rendered rows is bounded by the viewport, whatever the list length.
async function expectBounded(window, extra = BOUND_EXTRA) {
  const height = await window.getByTestId('list-view').evaluate((el) => el.clientHeight);
  const bound = Math.ceil(height / ROW_HEIGHT) + extra;
  const rendered = await window.getByTestId('list-row').count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThanOrEqual(bound);
  return { height, bound, rendered };
}

const scrollHeight = (window) => window.getByTestId('list-view').evaluate((el) => el.scrollHeight);

test('the fixture becomes a collection through the UI', async () => {
  test.setTimeout(180000);
  const total = Object.values(fixture.counts).reduce((a, b) => a + b, 0);
  expect(total).toBe(10000);
  for (const kind of KINDS) expect(sorted[kind]).toHaveLength(fixture.counts[kind]);

  session = await launchApp(userDataDir);
  const { app, window } = session;
  await stubFolderPicker(app, [fixture.root]);
  await window.getByTestId('collection-name').fill('Large');
  await window.getByTestId('add-folder').click();
  await expect(window.getByTestId('folder-item')).toHaveCount(1);
  await window.getByTestId('create-collection').click();
  await expect(window.getByTestId('collection-item').filter({ hasText: 'Large' })).toHaveCount(1, { timeout: 170000 });
  await window.getByTestId('collection-item').click();
  await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 60000 });
});

test('the largest list stays bounded in the DOM; End reaches the last row, Home the first, the middle renders its own rows', async () => {
  test.setTimeout(180000);
  const { window } = session;
  const largest = KINDS.reduce((a, b) => (fixture.counts[b] > fixture.counts[a] ? b : a));
  const count = fixture.counts[largest];
  const expected = sorted[largest];
  const list = window.getByTestId('list-view');

  // Time to first render is recorded, not asserted.
  const started = Date.now();
  await window.getByTestId(`view-tab-${largest}`).click();
  await expect(window.getByTestId('list-row').first()).toBeVisible({ timeout: 120000 });
  const elapsed = Date.now() - started;
  const note = `time to first render of the ${largest} list (${count} files): ${elapsed} ms`;
  console.log(note);
  await test.info().attach('first-render.txt', { body: note, contentType: 'text/plain' });

  const opened = await expectBounded(window);
  expect(await scrollHeight(window)).toBe(count * ROW_HEIGHT);
  expect((await listRows(window))[0].path).toBe(expected[0].path);

  // End: the last row is rendered, focused and in view, and the DOM is still bounded.
  await list.focus();
  await window.keyboard.press('End');
  const last = window.locator(`[data-testid="list-row"][data-index="${count - 1}"]`);
  await expect(last).toHaveCount(1);
  await expect(last).toHaveAttribute('data-path', expected[count - 1].path);
  await expect(last).toHaveClass(/list-focused/);
  await expect(list).toHaveAttribute('aria-activedescendant', `list-row-${count - 1}`);
  const inView = () =>
    window.evaluate((index) => {
      const box = document.querySelector('[data-testid="list-view"]').getBoundingClientRect();
      const row = document.querySelector(`[data-testid="list-row"][data-index="${index}"]`).getBoundingClientRect();
      return row.top >= box.top && row.bottom <= box.bottom;
    }, count - 1);
  await expect.poll(inView).toBe(true);
  const atEnd = await expectBounded(window);
  expect(atEnd.height).toBe(opened.height);

  // Home returns to the first row.
  await window.keyboard.press('Home');
  const first = window.locator('[data-testid="list-row"][data-index="0"]');
  await expect(first).toHaveAttribute('data-path', expected[0].path);
  await expect(first).toHaveClass(/list-focused/);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
  await expectBounded(window);

  // The middle: set scrollTop; rows of that region are rendered and no others, apart from the
  // focused row (the first), which stays in the DOM for aria-activedescendant.
  const middle = Math.floor(count / 2);
  await list.evaluate((el, top) => { el.scrollTop = top; }, middle * ROW_HEIGHT);
  const target = window.locator(`[data-testid="list-row"][data-index="${middle}"]`);
  await expect(target).toHaveAttribute('data-path', expected[middle].path);
  const region = await expectBounded(window, BOUND_EXTRA + 1);
  const rows = await listRows(window);
  const viewportRows = Math.ceil(region.height / ROW_HEIGHT);
  const outside = rows.filter((r) => r.index < middle - 5 || r.index > middle + viewportRows + 5);
  expect(outside.map((r) => r.index)).toEqual([0]);
  for (const r of rows) expect(r.path).toBe(expected[r.index].path);
});

test('the other three kinds are bounded too, with the scroll range of their own count', async () => {
  test.setTimeout(180000);
  const { window } = session;
  for (const kind of KINDS) {
    await window.getByTestId(`view-tab-${kind}`).click();
    await expect(window.getByTestId('list-row').first()).toBeVisible({ timeout: 120000 });
    await expect(window.getByTestId('list-loading')).toHaveCount(0);
    await expectBounded(window);
    expect(await scrollHeight(window)).toBe(fixture.counts[kind] * ROW_HEIGHT);
    expect((await listRows(window))[0].path).toBe(sorted[kind][0].path);
  }
});
