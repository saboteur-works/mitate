'use strict';

/*
 * List view selection, keyboard and ARIA e2e (Feature 4, Task 7; FR-5, FR-6, FR-7). The spec drives
 * ListView directly on a container it mounts in the page, with 2,000 generated rows, and records
 * every `file-selected` event the list dispatches.
 */

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp } = require('../support/e2e-app.js');

const COUNT = 2000;

const rowData = (i) => ({
  nodeId: `f1:Photos/img${i + 1}.jpg`,
  path: `/root/Photos/img${i + 1}.jpg`,
  name: `img${i + 1}.jpg`,
  folderId: 'f1',
  relativePath: `Photos/img${i + 1}.jpg`,
  kind: 'image',
  unavailable: i === 2,
  folder: 'Photos',
});

// Mounts the host, records file-selected events into window.__selected, renders rows [from, to).
const mountAndRender = (window, from, to) =>
  window.evaluate(
    ({ a, b }) => {
      let host = document.getElementById('select-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'select-host';
        document.body.appendChild(host);
        window.__selected = [];
        document.addEventListener('file-selected', (e) => window.__selected.push(e.detail.file));
      }
      const rows = [];
      for (let i = a; i < b; i++) {
        rows.push({
          nodeId: `f1:Photos/img${i + 1}.jpg`,
          path: `/root/Photos/img${i + 1}.jpg`,
          name: `img${i + 1}.jpg`,
          folderId: 'f1',
          relativePath: `Photos/img${i + 1}.jpg`,
          kind: 'image',
          unavailable: i === 2,
          folder: 'Photos',
        });
      }
      ListView.render(host, rows, 'none');
    },
    { a: from, b: to },
  );

const events = (window) => window.evaluate(() => window.__selected);
const setScroll = (window, top) =>
  window.evaluate((t) => {
    document.getElementById('select-host').scrollTop = t;
  }, top);
const maxScroll = (window) =>
  window.evaluate(() => {
    const h = document.getElementById('select-host');
    return h.scrollHeight - h.clientHeight;
  });
const activeIndex = async (host) => {
  const id = await host.getAttribute('aria-activedescendant');
  return id === null ? null : Number(id.replace('list-row-', ''));
};

test('list view selection, keyboard model and ARIA roles', async () => {
  const userDataDir = newUserDataDir('list-select-e2e');
  let session;
  try {
    session = await launchApp(userDataDir);
    const { window } = session;
    await mountAndRender(window, 0, COUNT);
    const host = window.locator('#select-host');
    const rowAt = (i) => host.locator(`[data-testid="list-row"][data-index="${i}"]`);

    // Roles: one Tab stop, options as rows, aria-activedescendant on the focused row.
    await expect(host).toHaveAttribute('role', 'listbox');
    await expect(host).toHaveAttribute('tabindex', '0');
    await expect(host.locator('[tabindex]')).toHaveCount(0);
    await expect(rowAt(0)).toHaveAttribute('role', 'option');
    await expect(host).toHaveAttribute('aria-activedescendant', 'list-row-0');
    await expect(rowAt(0)).toHaveAttribute('id', 'list-row-0');

    // Click selects that row only and dispatches file-selected once with the row's values.
    await rowAt(3).click();
    await expect(rowAt(3)).toHaveAttribute('aria-selected', 'true');
    await expect(host.locator('[aria-selected="true"]')).toHaveCount(1);
    expect(await events(window)).toEqual([
      {
        nodeId: rowData(3).nodeId,
        path: rowData(3).path,
        name: rowData(3).name,
        folderId: 'f1',
        relativePath: rowData(3).relativePath,
        kind: 'image',
        unavailable: false,
      },
    ]);
    await expect(host).toHaveAttribute('aria-activedescendant', 'list-row-3');

    // A row flagged unavailable carries that flag in the detail.
    await rowAt(2).click();
    expect((await events(window))[1].unavailable).toBe(true);
    await rowAt(3).click();
    expect(await events(window)).toHaveLength(3);

    // Enter and Space select the focused row; arrows move focus one row without wrapping.
    await host.focus();
    await window.keyboard.press('ArrowDown');
    await expect(host).toHaveAttribute('aria-activedescendant', 'list-row-4');
    await expect(rowAt(3)).toHaveAttribute('aria-selected', 'true');
    await window.keyboard.press('Enter');
    await expect(rowAt(4)).toHaveAttribute('aria-selected', 'true');
    await expect(host.locator('[aria-selected="true"]')).toHaveCount(1);
    expect((await events(window)).at(-1).nodeId).toBe(rowData(4).nodeId);
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Space');
    await expect(rowAt(5)).toHaveAttribute('aria-selected', 'true');
    expect((await events(window)).at(-1).nodeId).toBe(rowData(5).nodeId);
    await window.keyboard.press('ArrowUp');
    await expect(host).toHaveAttribute('aria-activedescendant', 'list-row-4');
    const afterArrows = (await events(window)).length;

    // No wrapping at the top.
    await window.keyboard.press('Home');
    await expect(host).toHaveAttribute('aria-activedescendant', 'list-row-0');
    await window.keyboard.press('ArrowUp');
    await expect(host).toHaveAttribute('aria-activedescendant', 'list-row-0');

    // End: focus and scroll to the last row, selection untouched; Home returns.
    await window.keyboard.press('End');
    await expect(host).toHaveAttribute('aria-activedescendant', `list-row-${COUNT - 1}`);
    await expect(rowAt(COUNT - 1)).toHaveClass(/list-focused/);
    await expect(rowAt(COUNT - 1)).toHaveAttribute('aria-selected', 'false');
    await expect.poll(() => host.evaluate((el) => el.scrollTop)).toBe(await maxScroll(window));
    expect(await events(window)).toHaveLength(afterArrows);
    await window.keyboard.press('ArrowDown');
    await expect(host).toHaveAttribute('aria-activedescendant', `list-row-${COUNT - 1}`);

    // The focused row stays rendered after scrolling far away.
    await setScroll(window, 0);
    await expect(rowAt(1)).toHaveCount(1);
    await expect(rowAt(COUNT - 1)).toHaveCount(1);
    await expect(host).toHaveAttribute('aria-activedescendant', `list-row-${COUNT - 1}`);

    await window.keyboard.press('Home');
    await expect(rowAt(0)).toHaveClass(/list-focused/);
    await expect.poll(() => host.evaluate((el) => el.scrollTop)).toBe(0);

    // The selection is held by node id: scroll the selected row out of the window and back.
    await expect(rowAt(5)).toHaveAttribute('aria-selected', 'true');
    await setScroll(window, 1000 * 24);
    await expect(rowAt(1000)).toHaveCount(1);
    await expect(rowAt(5)).toHaveCount(0);
    await setScroll(window, 0);
    await expect(rowAt(5)).toHaveAttribute('aria-selected', 'true');

    // Render with rows that still contain the id keeps it, without dispatching.
    const beforeRerender = (await events(window)).length;
    await mountAndRender(window, 0, 500);
    await expect(rowAt(5)).toHaveAttribute('aria-selected', 'true');
    expect(await events(window)).toHaveLength(beforeRerender);

    // Render with rows that lack the id clears the selection and dispatches null.
    await mountAndRender(window, 100, 600);
    await expect(host.locator('[aria-selected="true"]')).toHaveCount(0);
    const afterReplace = await events(window);
    expect(afterReplace).toHaveLength(beforeRerender + 1);
    expect(afterReplace.at(-1)).toBeNull();

    // clearSelection dispatches null once when something was selected, nothing when not.
    await mountAndRender(window, 0, 500);
    await rowAt(7).click();
    const beforeClear = (await events(window)).length;
    await window.evaluate(() => ListView.clearSelection());
    await expect(host.locator('[aria-selected="true"]')).toHaveCount(0);
    expect(await events(window)).toHaveLength(beforeClear + 1);
    expect((await events(window)).at(-1)).toBeNull();
    await window.evaluate(() => ListView.clearSelection());
    expect(await events(window)).toHaveLength(beforeClear + 1);
  } finally {
    await session?.app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
