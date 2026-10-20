'use strict';

/*
 * Tree keyboard navigation e2e (Feature 2, Task 8; FR-2, FR-11). Collections are seeded into
 * <userDataDir>/store.json before launch with openStorage, as in file-selection.spec.js.
 * Row order is read from the DOM (data-index / data-type) rather than assumed.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, rowAt, selectOnlyCollection } = require('../support/e2e-app.js');
const { lookupFileName } = require('../../src/main/registry/types.js');
const { openStorage } = require('../../src/main/storage/index.js');

function fileRecord(folderPath, rel) {
  const name = rel.split('/').pop();
  const { extension, kind, subtype } = lookupFileName(name);
  return { path: `${folderPath}/${rel}`, relativePath: rel, name, extension, kind, ...(subtype ? { subtype } : {}) };
}

function seedCollection(userDataDir, folderId, folderPath, files) {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  storage.putCollection({
    id: 'col-1',
    name: 'Keys',
    folderIds: [folderId],
    createdAt: new Date().toISOString(),
  });
  storage.putFolder({ id: folderId, collectionId: 'col-1', path: folderPath, unavailable: false });
  storage.replaceFolderIndex(folderId, files.map((rel) => fileRecord(folderPath, rel)));
}

const recordEvents = (window) =>
  window.evaluate(() => {
    window.__fileSelected = [];
    document.addEventListener('file-selected', (e) => window.__fileSelected.push(e.detail));
  });
const events = (window) => window.evaluate(() => window.__fileSelected);

const tree = (window) => window.getByTestId('tree-view');
const selectedRows = (window) => window.locator('[data-testid="tree-row"][aria-selected="true"]');
const rowCount = (window) => window.evaluate(() => document.querySelectorAll('[data-testid="tree-row"]').length);

// The row aria-activedescendant points at, and how many rows carry .tree-focused.
const focusInfo = (window) =>
  window.evaluate(() => {
    const tv = document.querySelector('[data-testid="tree-view"]');
    const id = tv.getAttribute('aria-activedescendant');
    const el = id ? document.getElementById(id) : null;
    return {
      id,
      index: el ? Number(el.dataset.index) : null,
      path: el ? el.dataset.path : null,
      focusedClassCount: document.querySelectorAll('.tree-focused').length,
      activeHasClass: el !== null && el.classList.contains('tree-focused'),
    };
  });

const rowIndex = async (window, p) => Number(await rowAt(window, p).getAttribute('data-index'));

async function press(window, key, times = 1) {
  for (let i = 0; i < times; i++) await window.keyboard.press(key);
}

// Presses Tab from the document start until the tree is the active element. Returns the number of
// presses used, or -1 when the tree was not reached within `limit` presses.
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

async function withSeededApp(label, folderId, files, body) {
  const userDataDir = newUserDataDir('tree-keys');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `mo-tree-keys-${label}-`));
  let session;
  try {
    seedCollection(userDataDir, folderId, base, files);
    session = await launchApp(userDataDir);
    await selectOnlyCollection(session.window);
    await body(session.window, base);
  } finally {
    if (session) await session.app.close();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

test('the tree is one Tab stop; arrows move focus across folder and file rows without wrapping; Enter and Space act on the focused row', async () => {
  await withSeededApp('nav', 'f-nav', ['sub/s1.jpg', 'a.jpg', 'b.jpg'], async (window, base) => {
    await recordEvents(window);
    const tv = tree(window);
    await expect(tv).toHaveAttribute('role', 'tree');
    await expect(tv).toHaveAttribute('tabindex', '0');

    // Single Tab stop: reached once, one more Tab leaves it, no row is a Tab stop.
    const presses = await tabToTree(window);
    expect(presses).toBeGreaterThan(0);
    await expect(tv).toBeFocused();
    await window.keyboard.press('Tab');
    expect(await window.evaluate(() => document.activeElement === document.querySelector('[data-testid="tree-view"]'))).toBe(false);
    expect(await window.evaluate(() => !!document.activeElement.closest('[data-testid="tree-view"]'))).toBe(false);
    expect(await window.locator('[data-testid="tree-row"][tabindex]').count()).toBe(0);
    await window.keyboard.press('Shift+Tab');
    await expect(tv).toBeFocused();

    // Initial focus is the first row (the only row, the collapsed root); ArrowUp/Down do not wrap.
    let info = await focusInfo(window);
    expect(info.index).toBe(0);
    expect(info.path).toBe(base);
    expect(info.focusedClassCount).toBe(1);
    expect(info.activeHasClass).toBe(true);
    await press(window, 'ArrowUp');
    expect((await focusInfo(window)).index).toBe(0);
    await press(window, 'ArrowDown');
    expect((await focusInfo(window)).index).toBe(0);

    // Enter on the focused folder expands it and selects nothing; Space collapses it again.
    await press(window, 'Enter');
    await expect(rowAt(window, base)).toHaveAttribute('aria-expanded', 'true');
    expect(await rowCount(window)).toBe(4);
    await press(window, 'Space');
    await expect(rowAt(window, base)).toHaveAttribute('aria-expanded', 'false');
    expect(await rowCount(window)).toBe(1);
    await press(window, 'Enter');
    expect(await rowCount(window)).toBe(4);
    await expect(selectedRows(window)).toHaveCount(0);
    expect(await events(window)).toEqual([]);

    // Down to the last row, then past it (no wrap), then Up to the first row, then past it.
    await press(window, 'ArrowDown');
    info = await focusInfo(window);
    expect(info.index).toBe(1);
    expect(info.focusedClassCount).toBe(1);
    expect(info.activeHasClass).toBe(true);
    await press(window, 'ArrowDown', 5);
    info = await focusInfo(window);
    expect(info.index).toBe(3);
    expect(info.focusedClassCount).toBe(1);
    await press(window, 'ArrowUp', 5);
    expect((await focusInfo(window)).index).toBe(0);

    // The focus indicator crosses folder and file rows: visit every row and record its type.
    const types = [];
    for (let i = 0; i < 4; i++) {
      const t = await window.evaluate(() => {
        const el = document.getElementById(document.querySelector('[data-testid="tree-view"]').getAttribute('aria-activedescendant'));
        return el.dataset.type;
      });
      types.push(t);
      await press(window, 'ArrowDown');
    }
    expect(types[0]).toBe('folder');
    expect(types).toContain('folder');
    expect(types).toContain('file');

    // Focus the subfolder; Enter expands it and selects nothing, Space collapses it.
    const sub = `${base}/sub`;
    await press(window, 'ArrowUp', 5);
    await press(window, 'ArrowDown', await rowIndex(window, sub));
    expect((await focusInfo(window)).path).toBe(sub);
    await press(window, 'Enter');
    await expect(rowAt(window, sub)).toHaveAttribute('aria-expanded', 'true');
    await expect(rowAt(window, `${sub}/s1.jpg`)).toHaveCount(1);
    expect((await focusInfo(window)).path).toBe(sub);
    await press(window, 'Space');
    await expect(rowAt(window, sub)).toHaveAttribute('aria-expanded', 'false');
    await expect(rowAt(window, `${sub}/s1.jpg`)).toHaveCount(0);
    await expect(selectedRows(window)).toHaveCount(0);
    expect(await events(window)).toEqual([]);

    // Enter on a focused file selects it and emits file-selected; Space on another file does too.
    const a = `${base}/a.jpg`;
    const b = `${base}/b.jpg`;
    await press(window, 'ArrowUp', 5);
    await press(window, 'ArrowDown', await rowIndex(window, a));
    expect((await focusInfo(window)).path).toBe(a);
    await press(window, 'Enter');
    await expect(rowAt(window, a)).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
    let seen = await events(window);
    expect(seen).toHaveLength(1);
    expect(seen[0].file.path).toBe(a);
    expect(seen[0].file.nodeId).toBe(await rowAt(window, a).getAttribute('data-node-id'));

    await press(window, 'ArrowUp', 5);
    await press(window, 'ArrowDown', await rowIndex(window, b));
    expect((await focusInfo(window)).path).toBe(b);
    await press(window, 'Space');
    await expect(rowAt(window, b)).toHaveAttribute('aria-selected', 'true');
    await expect(rowAt(window, a)).not.toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
    seen = await events(window);
    expect(seen).toHaveLength(2);
    expect(seen[1].file.path).toBe(b);
    expect((await focusInfo(window)).path).toBe(b);
  });
});

test('Space on the tree does not scroll the page', async () => {
  await withSeededApp('space', 'f-space', ['a.jpg', 'b.jpg'], async (window, base) => {
    await window.evaluate(() => {
      window.__spaceDefaultPrevented = [];
      document.addEventListener('keydown', (e) => {
        if (e.key === ' ') window.__spaceDefaultPrevented.push(e.defaultPrevented);
      });
    });
    expect(await tabToTree(window)).toBeGreaterThan(0);
    const scrollOf = () =>
      window.evaluate(() => ({
        page: document.scrollingElement.scrollTop,
        tree: document.querySelector('[data-testid="tree-view"]').scrollTop,
      }));
    const before = await scrollOf();
    await press(window, 'Space');
    await press(window, 'ArrowDown');
    await press(window, 'Space');
    expect(await scrollOf()).toEqual(before);
    // The page may not be scrollable at all, so also assert the keydown was cancelled.
    expect(await window.evaluate(() => window.__spaceDefaultPrevented)).toEqual([true, true]);
  });
});

test('ArrowDown past the viewport bottom scrolls the focused row into view; the focused row stays rendered when virtualized away', async () => {
  const files = Array.from({ length: 300 }, (_, i) => `f${String(i).padStart(3, '0')}.jpg`);
  await withSeededApp('scroll', 'f-scroll', files, async (window, base) => {
    const tv = tree(window);
    await rowAt(window, base).click(); // expands and focuses the root row
    await expect(rowAt(window, `${base}/${files[299]}`)).toHaveCount(0);
    await expect(tv).toBeFocused();
    expect((await focusInfo(window)).index).toBe(0);
    expect(await tv.evaluate((el) => el.scrollTop)).toBe(0);

    // 60 rows down is well past the first viewport.
    await press(window, 'ArrowDown', 60);
    let info = await focusInfo(window);
    expect(info.index).toBe(60);
    expect(info.focusedClassCount).toBe(1);
    expect(await tv.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const inView = () =>
      window.evaluate(() => {
        const t = document.querySelector('[data-testid="tree-view"]').getBoundingClientRect();
        const el = document.getElementById(document.querySelector('[data-testid="tree-view"]').getAttribute('aria-activedescendant'));
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top >= t.top - 1, bottom: r.bottom <= t.bottom + 1 };
      });
    expect(await inView()).toEqual({ top: true, bottom: true });
    expect(await rowCount(window)).toBeLessThan(100); // virtualized: not all 301 rows are in the DOM

    // Scroll the focused row far out of the virtual window: it is still in the DOM.
    await tv.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(rowAt(window, `${base}/${files[299]}`)).toHaveCount(1);
    await expect(window.locator('#' + info.id)).toHaveCount(1);
    await expect(window.locator('#' + info.id)).toHaveClass(/tree-focused/);
    expect((await focusInfo(window)).index).toBe(60);
    expect(await rowCount(window)).toBeLessThan(100);

    // ArrowUp moves to the previous row and scrolls it back into view.
    await press(window, 'ArrowUp');
    info = await focusInfo(window);
    expect(info.index).toBe(59);
    expect(await inView()).toEqual({ top: true, bottom: true });
    await press(window, 'ArrowUp', 70);
    expect((await focusInfo(window)).index).toBe(0);
    expect(await tv.evaluate((el) => el.scrollTop)).toBe(0);
  });
});

test('clicking a row sets the focus to it; focus falls back to the first row when its node disappears after update', async () => {
  await withSeededApp('click', 'f-click', ['a.jpg', 'b.jpg'], async (window, base) => {
    await recordEvents(window);
    const a = `${base}/a.jpg`;
    const b = `${base}/b.jpg`;
    await rowAt(window, base).click();
    let info = await focusInfo(window);
    expect(info.path).toBe(base);
    expect(info.focusedClassCount).toBe(1);

    await rowAt(window, b).click();
    info = await focusInfo(window);
    expect(info.path).toBe(b);
    expect(info.focusedClassCount).toBe(1);
    expect(info.activeHasClass).toBe(true);
    await expect(rowAt(window, b)).toHaveAttribute('aria-selected', 'true');

    // Keyboard continues from the clicked row.
    await press(window, 'ArrowUp');
    expect((await focusInfo(window)).path).toBe(a);
    await rowAt(window, base).click(); // folder click: focus moves, selection unchanged, toggles
    info = await focusInfo(window);
    expect(info.path).toBe(base);
    await expect(rowAt(window, base)).toHaveAttribute('aria-expanded', 'false');
    await expect(rowAt(window, b)).toHaveCount(0);
    expect(await events(window)).toHaveLength(1);
    await rowAt(window, base).click();
    await expect(rowAt(window, b)).toHaveCount(1);
    await rowAt(window, b).click();
    expect((await focusInfo(window)).path).toBe(b);

    // update removes b: focus falls back to the first row.
    await window.evaluate((p) => {
      const rec = {
        folderId: 'f-click', collectionId: 'col-1', path: `${p}/a.jpg`, relativePath: 'a.jpg',
        name: 'a.jpg', extension: 'jpg', kind: 'image',
      };
      window.TreeView.update([{ id: 'f-click', collectionId: 'col-1', path: p, unavailable: false }], [rec]);
    }, base);
    await expect(rowAt(window, b)).toHaveCount(0);
    info = await focusInfo(window);
    expect(info.index).toBe(0);
    expect(info.path).toBe(base);
    expect(info.focusedClassCount).toBe(1);
    expect(info.activeHasClass).toBe(true);
  });
});
