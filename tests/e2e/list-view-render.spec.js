'use strict';

/*
 * List view rendering e2e (Feature 4, Task 6; FR-3, FR-4, FR-8). The spec drives ListView
 * directly: it mounts its own container in the page and calls ListView.render / setLoading
 * with generated rows, so it needs no collection and no test hook in the app.
 */

const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp } = require('../support/e2e-app.js');
const fs = require('node:fs');

const ROW_HEIGHT = 24;
const BUFFER_EXTRA = 11; // 2 * buffer + 1 partial row on top of the viewport rows

// Creates (or reuses) the host element the list is rendered into.
const mountHost = (window) =>
  window.evaluate(() => {
    if (!document.getElementById('render-host')) {
      const host = document.createElement('div');
      host.id = 'render-host';
      document.body.appendChild(host);
    }
  });

// Renders `count` generated rows (or the given rows) into the host.
const renderGenerated = (window, count, emptyText = '') =>
  window.evaluate(
    ({ n, text }) => {
      const rows = Array.from({ length: n }, (_, i) => ({
        nodeId: `f1:Photos/img${i + 1}.jpg`,
        path: `/root/Photos/img${i + 1}.jpg`,
        name: `img${i + 1}.jpg`,
        folderId: 'f1',
        relativePath: `Photos/img${i + 1}.jpg`,
        kind: 'image',
        unavailable: false,
        folder: 'Photos',
      }));
      ListView.render(document.getElementById('render-host'), rows, text);
    },
    { n: count, text: emptyText },
  );

const renderRows = (window, rows, emptyText = '') =>
  window.evaluate(
    ({ list, text }) => ListView.render(document.getElementById('render-host'), list, text),
    { list: rows, text: emptyText },
  );

const hostMetrics = (window) =>
  window.evaluate(() => {
    const host = document.getElementById('render-host');
    return {
      clientHeight: host.clientHeight,
      scrollHeight: host.scrollHeight,
      rendered: host.querySelectorAll('[data-testid="list-row"]').length,
    };
  });

test('list view renders rows, windows a long list, and shows its states', async () => {
  const userDataDir = newUserDataDir('list-render-e2e');
  let session;
  try {
    session = await launchApp(userDataDir);
    const { window } = session;
    await mountHost(window);
    const host = window.locator('#render-host');
    const rowsIn = host.getByTestId('list-row');

    // Exactly the rows given, with name text and a folder part.
    await renderRows(window, [
      { nodeId: 'f1:a.jpg', path: '/r/a.jpg', name: 'a.jpg', folderId: 'f1', relativePath: 'a.jpg', kind: 'image', unavailable: false, folder: 'r' },
      { nodeId: 'f1:Photos/b.png', path: '/r/Photos/b.png', name: 'b.png', folderId: 'f1', relativePath: 'Photos/b.png', kind: 'image', unavailable: false, folder: 'Photos' },
      { nodeId: 'f1:Photos/2024/c.heic', path: '/r/Photos/2024/c.heic', name: 'c.heic', folderId: 'f1', relativePath: 'Photos/2024/c.heic', kind: 'image', unavailable: false, folder: 'Photos/2024' },
    ]);
    await expect(rowsIn).toHaveCount(3);
    await expect(rowsIn.nth(0)).toContainText('a.jpg');
    await expect(rowsIn.nth(1).getByTestId('list-row-folder')).toHaveText('Photos');
    await expect(rowsIn.nth(2).getByTestId('list-row-folder')).toHaveText('Photos/2024');
    await expect(host.getByTestId('unavailable')).toHaveCount(0);

    // 2,000 rows: bounded DOM, full scroll range, last row reachable.
    await renderGenerated(window, 2000);
    await expect(rowsIn.first()).toBeVisible();
    const top = await hostMetrics(window);
    expect(top.clientHeight).toBeGreaterThan(0);
    expect(top.scrollHeight).toBe(2000 * ROW_HEIGHT);
    const bound = Math.ceil(top.clientHeight / ROW_HEIGHT) + BUFFER_EXTRA;
    expect(top.rendered).toBeGreaterThan(0);
    expect(top.rendered).toBeLessThanOrEqual(bound);

    await window.evaluate(() => {
      const el = document.getElementById('render-host');
      el.scrollTop = el.scrollHeight;
    });
    await expect(host.locator('[data-testid="list-row"][data-index="1999"]')).toHaveCount(1);
    await expect(host.locator('[data-testid="list-row"][data-index="1999"]')).toContainText('img2000.jpg');
    // The focused row (the first one) stays rendered outside the window: one extra element.
    const bottom = await hostMetrics(window);
    expect(bottom.rendered).toBeLessThanOrEqual(bound + 1);

    // Empty state: the text given, no rows.
    await renderRows(window, [], 'No image files in this collection');
    await expect(host.getByTestId('list-empty')).toHaveText('No image files in this collection');
    await expect(rowsIn).toHaveCount(0);

    // Loading state: the loading text, no rows.
    await renderGenerated(window, 3);
    await expect(rowsIn).toHaveCount(3);
    await window.evaluate(() => ListView.setLoading(true));
    await expect(host.getByTestId('list-loading')).toBeVisible();
    await expect(rowsIn).toHaveCount(0);
    await expect(host.getByTestId('list-empty')).toHaveCount(0);
    await window.evaluate(() => ListView.setLoading(false));
    await expect(host.getByTestId('list-loading')).toHaveCount(0);

    // Unavailable row: labelled and still present. Names are set as text, never as HTML.
    await renderRows(window, [
      { nodeId: 'f2:<b>x</b>.jpg', path: '/gone/<b>x</b>.jpg', name: '<b>x</b>.jpg', folderId: 'f2', relativePath: '<b>x</b>.jpg', kind: 'image', unavailable: true, folder: '<i>gone</i>' },
    ]);
    await expect(rowsIn).toHaveCount(1);
    await expect(rowsIn.first().getByTestId('unavailable')).toHaveText('unavailable');
    await expect(rowsIn.first().getByTestId('list-row-name')).toHaveText('<b>x</b>.jpg');
    await expect(rowsIn.first().getByTestId('list-row-folder')).toHaveText('<i>gone</i>');
    await expect(rowsIn.first().locator('b, i')).toHaveCount(0);
  } finally {
    await session?.app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
