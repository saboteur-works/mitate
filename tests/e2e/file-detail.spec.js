'use strict';

/*
 * File detail area e2e (Feature 2, Task 9). Collections are written to
 * <userDataDir>/store.json before launch, as in file-selection.spec.js.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { newUserDataDir, launchApp, rowAt, selectOnlyCollection } = require('../support/e2e-app.js');
const { lookupFileName } = require('../../src/main/registry/types.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const EMPTY_TEXT = 'Select a file to see its location';

function fileRecord(folderPath, rel) {
  const name = rel.split('/').pop();
  const { extension, kind, subtype } = lookupFileName(name);
  return { path: `${folderPath}/${rel}`, relativePath: rel, name, extension, kind, ...(subtype ? { subtype } : {}) };
}

// folders = [{ id, path, unavailable, files: [rel, ...] }]
function seedCollection(userDataDir, name, folders) {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  storage.putCollection({
    id: 'col-1',
    name,
    folderIds: folders.map((f) => f.id),
    createdAt: new Date().toISOString(),
  });
  for (const f of folders) {
    storage.putFolder({ id: f.id, collectionId: 'col-1', path: f.path, unavailable: f.unavailable === true });
    storage.replaceFolderIndex(f.id, f.files.map((rel) => fileRecord(f.path, rel)));
  }
}

const pathEl = (window) => window.getByTestId('file-path');
const revealBtn = (window) => window.getByTestId('reveal');

test('the detail area follows the selected file; folder clicks leave it unchanged', async () => {
  const userDataDir = newUserDataDir('detail-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  const docs = `${root}/Docs`;
  const report = `${docs}/report.pdf`;
  const topFile = `${root}/top.mp3`;
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Detail', [root]);

    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);

    // Before any selection: empty-state text, disabled native button with the exact label.
    await expect(pathEl(window)).toHaveText(EMPTY_TEXT);
    await expect(revealBtn(window)).toBeDisabled();
    await expect(revealBtn(window)).toHaveText('Reveal in Finder');
    expect(await revealBtn(window).evaluate((el) => el.tagName)).toBe('BUTTON');

    // A folder click selects nothing: still the empty state.
    await rowAt(window, root).click();
    await rowAt(window, docs).click();
    await expect(rowAt(window, report)).toHaveCount(1);
    await expect(pathEl(window)).toHaveText(EMPTY_TEXT);
    await expect(revealBtn(window)).toBeDisabled();

    // Selecting a file shows its stored absolute path and enables the button.
    await rowAt(window, report).click();
    await expect(pathEl(window)).toHaveText(report);
    expect(await pathEl(window).evaluate((el) => el.textContent)).toBe(report);
    await expect(revealBtn(window)).toBeEnabled();
    await expect(revealBtn(window)).toHaveText('Reveal in Finder');

    // Selecting another file updates the text.
    await rowAt(window, topFile).click();
    expect(await pathEl(window).evaluate((el) => el.textContent)).toBe(topFile);
    await expect(revealBtn(window)).toBeEnabled();

    // Folder clicks (collapse and expand) leave the text and the button state unchanged.
    await rowAt(window, docs).click();
    await expect(rowAt(window, docs)).toHaveAttribute('aria-expanded', 'false');
    expect(await pathEl(window).evaluate((el) => el.textContent)).toBe(topFile);
    await expect(revealBtn(window)).toBeEnabled();
    await rowAt(window, docs).click();
    await expect(rowAt(window, docs)).toHaveAttribute('aria-expanded', 'true');
    expect(await pathEl(window).evaluate((el) => el.textContent)).toBe(topFile);
    await expect(revealBtn(window)).toBeEnabled();
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a file in an unavailable folder shows its path, keeps Reveal enabled, and its row keeps the unavailable label', async () => {
  const userDataDir = newUserDataDir('detail-e2e');
  const missing = path.join(userDataDir, 'missing', 'gone');
  const file = `${missing}/a.jpg`;
  let session;
  try {
    seedCollection(userDataDir, 'Gone', [{ id: 'f-gone', path: missing, unavailable: true, files: ['a.jpg'] }]);
    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);
    await rowAt(window, missing).click();
    await rowAt(window, file).click();
    expect(await pathEl(window).evaluate((el) => el.textContent)).toBe(file);
    await expect(revealBtn(window)).toBeEnabled();
    await expect(rowAt(window, file).getByTestId('unavailable')).toHaveText('unavailable');
  } finally {
    if (session) await session.app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// Two nested folders of 200 characters each put the stored path over 400 characters
// (each component is under 255). The 300-character minimum is asserted on the stored path.
test('a path over 300 characters is shown in full, wraps, is selectable, and needs no horizontal scroll', async () => {
  const userDataDir = newUserDataDir('detail-e2e');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-detail-long-'));
  const longRoot = path.join(base, 'a'.repeat(200), 'b'.repeat(200));
  const file = `${longRoot}/long.jpg`;
  let session;
  try {
    fs.mkdirSync(longRoot, { recursive: true });
    fs.writeFileSync(path.join(longRoot, 'long.jpg'), 'x');
    expect(file.length).toBeGreaterThan(300);
    seedCollection(userDataDir, 'Long', [{ id: 'f-long', path: longRoot, unavailable: false, files: ['long.jpg'] }]);

    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);
    await rowAt(window, longRoot).click();
    await rowAt(window, file).click();

    const el = pathEl(window);
    expect(await el.evaluate((n) => n.textContent)).toBe(file);
    const style = await el.evaluate((n) => {
      const cs = getComputedStyle(n);
      return {
        overflowWrap: cs.overflowWrap,
        textOverflow: cs.textOverflow,
        userSelect: cs.userSelect,
        scrollWidth: n.scrollWidth,
        clientWidth: n.clientWidth,
      };
    });
    expect(style.overflowWrap).toBe('anywhere');
    expect(style.textOverflow).not.toBe('ellipsis');
    expect(style.userSelect).toBe('text');
    expect(style.scrollWidth).toBeLessThanOrEqual(style.clientWidth);
  } finally {
    if (session) await session.app.close();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
