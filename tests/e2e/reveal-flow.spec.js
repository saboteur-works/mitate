'use strict';

/*
 * Reveal flow e2e (Feature 2, Task 11; FR-1, FR-2, FR-6, FR-14). Collections are seeded into
 * <userDataDir>/store.json before launch with openStorage, and the indexed files are written to
 * disk because the files:reveal channel checks that the file exists. The app runs hidden through
 * tests/support/background-main.js; shell.showItemInFolder is the recording stub from that file,
 * read with revealCalls(app). The real shell.showItemInFolder is never called.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, rowAt, selectOnlyCollection, revealCalls, resetRevealCalls,
} = require('../support/e2e-app.js');
const { lookupFileName } = require('../../src/main/registry/types.js');
const { openStorage } = require('../../src/main/storage/index.js');

function fileRecord(folderPath, rel) {
  const name = rel.split('/').pop();
  const { extension, kind, subtype } = lookupFileName(name);
  return { path: `${folderPath}/${rel}`, relativePath: rel, name, extension, kind, ...(subtype ? { subtype } : {}) };
}

function seedCollection(userDataDir, folderId, folderPath, files) {
  for (const rel of files) {
    const abs = `${folderPath}/${rel}`;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `reveal-flow:${rel}\n`);
  }
  const storage = openStorage({ location: { baseDir: userDataDir } });
  storage.putCollection({
    id: 'col-1',
    name: 'Reveal flow',
    folderIds: [folderId],
    createdAt: new Date().toISOString(),
  });
  storage.putFolder({ id: folderId, collectionId: 'col-1', path: folderPath, unavailable: false });
  storage.replaceFolderIndex(folderId, files.map((rel) => fileRecord(folderPath, rel)));
}

async function withSeededApp(label, files, body) {
  const userDataDir = newUserDataDir('reveal-flow');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `mo-reveal-flow-${label}-`));
  let session;
  try {
    seedCollection(userDataDir, `f-${label}`, base, files);
    session = await launchApp(userDataDir);
    await selectOnlyCollection(session.window);
    await body(session, base);
  } finally {
    if (session) await session.app.close();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

const tree = (window) => window.getByTestId('tree-view');
const revealBtn = (window) => window.getByTestId('reveal');
const filePath = (window) => window.getByTestId('file-path');
const revealError = (window) => window.getByTestId('reveal-error');
const selectedRows = (window) => window.locator('[data-testid="tree-row"][aria-selected="true"]');
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

// Keyboard only: Tab to the tree, expand the root, ArrowDown to `target`, Enter to select it.
async function selectByKeyboard(window, base, target) {
  expect(await tabToTree(window)).toBeGreaterThan(0);
  await expect(tree(window)).toBeFocused();
  expect(await focusedPath(window)).toBe(base);
  await press(window, 'Enter'); // expands the root folder
  await expect(rowAt(window, base)).toHaveAttribute('aria-expanded', 'true');
  await press(window, 'ArrowDown', await rowIndex(window, target));
  expect(await focusedPath(window)).toBe(target);
  await press(window, 'Enter');
  await expect(rowAt(window, target)).toHaveAttribute('aria-selected', 'true');
}

test('mouse: click a file row, click Reveal in Finder; the stub receives the row path, shown path equals it, no error, row stays selected', async () => {
  await withSeededApp('mouse', ['a.jpg', 'b.jpg'], async ({ app, window }, base) => {
    expect(await revealCalls(app)).toEqual([]);
    await rowAt(window, base).click(); // expands the root
    const a = `${base}/a.jpg`;
    const row = rowAt(window, a);
    await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    const rowPath = await row.getAttribute('data-path');
    expect(rowPath).toBe(a);
    await expect(filePath(window)).toHaveText(rowPath);
    await expect(revealBtn(window)).toBeEnabled();

    await revealBtn(window).click();
    await expect.poll(() => revealCalls(app)).toEqual([rowPath]);
    expect((await revealCalls(app))[0]).toBe(await filePath(window).textContent());
    await expect(revealError(window)).toBeHidden();
    expect(await revealError(window).textContent()).toBe('');
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
  });
});

test('keyboard only: Tab to the tree, ArrowDown to a file, Enter to select, Tab to Reveal, Space records the same path', async () => {
  await withSeededApp('keys', ['a.jpg', 'b.jpg'], async ({ app, window }, base) => {
    const b = `${base}/b.jpg`;
    await selectByKeyboard(window, base, b);
    await expect(filePath(window)).toHaveText(b);
    await expect(revealBtn(window)).toBeEnabled();
    expect(await revealCalls(app)).toEqual([]);

    await window.keyboard.press('Tab');
    await expect(revealBtn(window)).toBeFocused();
    await window.keyboard.press('Space');
    await expect.poll(() => revealCalls(app)).toEqual([b]);
    await expect(revealError(window)).toBeHidden();
    await expect(rowAt(window, b)).toHaveAttribute('aria-selected', 'true');
  });
});

test('keyboard only: Enter on the focused Reveal button also records the path', async () => {
  await withSeededApp('enter', ['a.jpg'], async ({ app, window }, base) => {
    const a = `${base}/a.jpg`;
    await selectByKeyboard(window, base, a);
    await window.keyboard.press('Tab');
    await expect(revealBtn(window)).toBeFocused();
    await window.keyboard.press('Enter');
    await expect.poll(() => revealCalls(app)).toEqual([a]);
  });
});

test('with no file selected the button is disabled and Enter or Space elsewhere records no call', async () => {
  await withSeededApp('none', ['a.jpg'], async ({ app, window }, base) => {
    await expect(revealBtn(window)).toBeDisabled();
    expect(await tabToTree(window)).toBeGreaterThan(0);
    await press(window, 'Enter'); // on the root folder: toggles it, selects nothing
    await press(window, 'Space');
    await press(window, 'Enter');
    await expect(selectedRows(window)).toHaveCount(0);
    await expect(revealBtn(window)).toBeDisabled();
    // Tab onward: a disabled button is not focusable, so it is never the active element.
    await window.keyboard.press('Tab');
    expect(await window.evaluate(() => document.activeElement === document.querySelector('[data-testid="reveal"]'))).toBe(false);
    await press(window, 'Enter');
    await press(window, 'Space');
    // Clicking the disabled button is not an activation either.
    await revealBtn(window).click({ force: true });
    expect(await revealCalls(app)).toEqual([]);
  });
});

test('selecting a folder row, by mouse and by keyboard, and activating nothing records no call', async () => {
  await withSeededApp('folder', ['sub/s1.jpg', 'a.jpg'], async ({ app, window }, base) => {
    const sub = `${base}/sub`;
    await rowAt(window, base).click(); // expands the root
    await rowAt(window, sub).click();
    await expect(selectedRows(window)).toHaveCount(0);
    await expect(revealBtn(window)).toBeDisabled();

    expect(await tabToTree(window)).toBeGreaterThan(0);
    await press(window, 'ArrowUp', 5);
    await press(window, 'ArrowDown', await rowIndex(window, sub));
    expect(await focusedPath(window)).toBe(sub);
    await press(window, 'Enter');
    await press(window, 'Space');
    await expect(selectedRows(window)).toHaveCount(0);
    await expect(revealBtn(window)).toBeDisabled();
    expect(await revealCalls(app)).toEqual([]);
  });
});

test('two activations record two calls with the same path', async () => {
  await withSeededApp('twice', ['a.jpg'], async ({ app, window }, base) => {
    const a = `${base}/a.jpg`;
    await rowAt(window, base).click();
    await rowAt(window, a).click();
    await revealBtn(window).click();
    await expect.poll(() => revealCalls(app)).toEqual([a]);
    // The button is disabled while a call is in flight; wait for it to be enabled again.
    await expect(revealBtn(window)).toBeEnabled();
    await revealBtn(window).click();
    await expect.poll(() => revealCalls(app)).toEqual([a, a]);

    await resetRevealCalls(app);
    expect(await revealCalls(app)).toEqual([]);
    await expect(revealBtn(window)).toBeEnabled();
    await revealBtn(window).focus();
    await window.keyboard.press('Space');
    await expect.poll(() => revealCalls(app)).toEqual([a]);
    await expect(revealBtn(window)).toBeEnabled();
    await window.keyboard.press('Space');
    await expect.poll(() => revealCalls(app)).toEqual([a, a]);
    await expect(revealError(window)).toBeHidden();
  });
});

test('no global shortcut: Meta+R and Ctrl+R with a file selected record no call', async () => {
  await withSeededApp('shortcut', ['a.jpg'], async ({ app, window }, base) => {
    const a = `${base}/a.jpg`;
    await rowAt(window, base).click();
    await rowAt(window, a).click();
    await expect(revealBtn(window)).toBeEnabled();

    for (const chord of ['Meta+R', 'Control+R', 'Meta+Shift+R', 'Control+Shift+R']) {
      await window.keyboard.press(chord);
    }
    await revealBtn(window).focus();
    for (const chord of ['Meta+R', 'Control+R']) await window.keyboard.press(chord);

    // Let any asynchronous IPC settle before reading the calls.
    await window.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(await revealCalls(app)).toEqual([]);
    await expect(filePath(window)).toHaveText(a);
    await expect(rowAt(window, a)).toHaveAttribute('aria-selected', 'true');
  });
});
