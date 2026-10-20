'use strict';

/*
 * Reveal error cases e2e (Feature 2, Task 12; FR-6, FR-9, FR-10, FR-12). Collections are seeded
 * into <userDataDir>/store.json before launch with openStorage, and the indexed files are written
 * to disk because the files:reveal channel checks that the file exists. The app runs hidden through
 * tests/support/background-main.js; shell.showItemInFolder is the recording stub from that file,
 * read with revealCalls(app). The guard, the index check (NOT_INDEXED) and the lstat check
 * (FILE_NOT_FOUND, message `File not found: <path>`) are the real ones.
 *
 * Error text is asserted with "contains": a rejected IPC promise may carry an Electron
 * "Error invoking remote method" prefix.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  newUserDataDir, launchApp, rowAt, selectOnlyCollection, revealCalls,
} = require('../support/e2e-app.js');
const {
  buildFixtureTree, cleanupFixtureTree, lockFolder, unlockFolder,
} = require('../support/fixture-tree.js');
const { lookupFileName } = require('../../src/main/registry/types.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

function fileRecord(folderPath, rel) {
  const name = rel.split('/').pop();
  const { extension, kind, subtype } = lookupFileName(name);
  return { path: `${folderPath}/${rel}`, relativePath: rel, name, extension, kind, ...(subtype ? { subtype } : {}) };
}

function seedCollection(userDataDir, folderId, folderPath, files) {
  for (const rel of files) {
    const abs = `${folderPath}/${rel}`;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `reveal-errors:${rel}\n`);
  }
  const storage = openStorage({ location: { baseDir: userDataDir } });
  storage.putCollection({
    id: 'col-1',
    name: 'Reveal errors',
    folderIds: [folderId],
    createdAt: new Date().toISOString(),
  });
  storage.putFolder({ id: folderId, collectionId: 'col-1', path: folderPath, unavailable: false });
  storage.replaceFolderIndex(folderId, files.map((rel) => fileRecord(folderPath, rel)));
}

const storedIndex = (userDataDir) => openStorage({ location: { baseDir: userDataDir } }).getIndex();

const revealBtn = (window) => window.getByTestId('reveal');
const filePath = (window) => window.getByTestId('file-path');
const revealError = (window) => window.getByTestId('reveal-error');
const selectedRows = (window) => window.locator('[data-testid="tree-row"][aria-selected="true"]');

// Expands the root folder row and selects the file row.
async function selectFile(window, base, file) {
  await rowAt(window, base).click();
  await rowAt(window, file).click();
  await expect(rowAt(window, file)).toHaveAttribute('aria-selected', 'true');
  await expect(filePath(window)).toHaveText(file);
  await expect(revealBtn(window)).toBeEnabled();
}

// Clicks Reveal and waits until the error element shows text. Returns that text.
async function revealExpectingError(window) {
  await revealBtn(window).click();
  await expect(revealError(window)).toBeVisible();
  return revealError(window).textContent();
}

// The error element is not a rescan control and holds none; the only rescan control is the
// existing Rescan button, which sits outside it.
async function expectNoRescanOffer(window) {
  const error = revealError(window);
  await expect(error.locator('button, a, input, [role="button"], [data-testid="rescan"]')).toHaveCount(0);
  await expect(window.getByTestId('rescan')).toHaveCount(1);
  await expect(error.getByText(/rescan/i)).toHaveCount(0);
  expect(await window.locator('button').evaluateAll((els) => els.map((el) => el.textContent.trim()).filter((t) => /rescan/i.test(t))))
    .toEqual(['Rescan']);
}

async function withSeededApp(label, files, body) {
  const userDataDir = newUserDataDir('reveal-errors');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `mo-reveal-errors-${label}-`));
  let session;
  try {
    seedCollection(userDataDir, `f-${label}`, base, files);
    const before = storedIndex(userDataDir);
    session = await launchApp(userDataDir);
    await selectOnlyCollection(session.window);
    await body(session, base, { userDataDir, before });
  } finally {
    if (session) await session.app.close().catch(() => {});
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

test('missing: a file deleted from disk after indexing gives an error naming its path; nothing is revealed, nothing changes', async () => {
  const userDataDir = newUserDataDir('reveal-errors');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-reveal-errors-missing-'));
  const gone = `${base}/gone.jpg`;
  let session;
  try {
    seedCollection(userDataDir, 'f-missing', base, ['gone.jpg', 'kept.jpg']);
    const before = storedIndex(userDataDir);
    expect(before.map((r) => r.path).sort()).toEqual([`${base}/gone.jpg`, `${base}/kept.jpg`]);
    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    await selectFile(window, base, gone);

    fs.rmSync(gone);
    const text = await revealExpectingError(window);
    expect(text).toContain(gone);
    expect(text).toContain('File not found');
    await expect(revealError(window)).toHaveAttribute('role', 'alert');

    expect(await revealCalls(app)).toEqual([]); // nothing revealed: not the file, not the parent folder
    await expectNoRescanOffer(window);
    await expect(rowAt(window, gone)).toHaveCount(1);
    await expect(rowAt(window, gone)).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
    await expect(filePath(window)).toHaveText(gone);
    await expect(revealBtn(window)).toBeEnabled();

    // A second attempt gives the same error and still no call.
    expect(await revealExpectingError(window)).toContain(gone);
    expect(await revealCalls(app)).toEqual([]);

    await session.app.close();
    session = null;
    const after = storedIndex(userDataDir);
    expect(after.map((r) => r.path)).toContain(gone);
    expect(after).toEqual(before);
  } finally {
    if (session) await session.app.close().catch(() => {});
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('unavailable: after the folder is removed and the app relaunched, its files show "unavailable", are selectable, and Reveal gives the missing-file error with no call', async () => {
  const userDataDir = newUserDataDir('reveal-errors');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-reveal-errors-unavail-'));
  const folder = path.join(base, 'vanishing');
  const file = `${folder}/a.jpg`;
  let session;
  try {
    fs.mkdirSync(folder);
    fs.writeFileSync(file, 'unavailable case\n');
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Vanishing', [folder]);
    const before = storedIndex(userDataDir);
    expect(before.map((r) => r.path)).toEqual([file]);

    fs.rmSync(folder, { recursive: true, force: true });

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    await rowAt(window, folder).click(); // expands the unavailable root
    await expect(rowAt(window, file)).toHaveCount(1);
    await expect(rowAt(window, file).getByTestId('unavailable')).toHaveText('unavailable');

    await rowAt(window, file).click();
    await expect(rowAt(window, file)).toHaveAttribute('aria-selected', 'true');
    expect(await filePath(window).textContent()).toBe(file);
    await expect(revealBtn(window)).toBeEnabled();

    const text = await revealExpectingError(window);
    expect(text).toContain(file);
    expect(text).toContain('File not found');
    expect(await revealCalls(app)).toEqual([]);
    await expect(rowAt(window, file).getByTestId('unavailable')).toHaveText('unavailable');
    await expect(rowAt(window, file)).toHaveAttribute('aria-selected', 'true');
    await expectNoRescanOffer(window);

    await session.app.close();
    session = null;
    expect(storedIndex(userDataDir)).toEqual(before);
  } finally {
    if (session) await session.app.close().catch(() => {});
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// lstat of a file inside a chmod 000 folder was observed to fail with EACCES (not ENOENT), so the
// existence check is refused: nothing is revealed and the error says the file could not be checked.
// The folder is the collection's root, so it is flagged unavailable on launch. The observed outcome
// is still logged.
test('unavailable but present: a file in a chmod 000 folder reports permission denied for the check (no reveal, no not-found claim), never another path', async () => {
  test.skip(typeof process.getuid === 'function' && process.getuid() === 0,
    'running as root: chmod 000 does not make a folder unreadable for root');
  const userDataDir = newUserDataDir('reveal-errors');
  const fixture = buildFixtureTree(); // a fresh copy of the fixture tree for this test
  const locked = `${fixture.root}/Docs`;
  const file = `${locked}/report.pdf`;
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Locked', [locked]);
    const before = storedIndex(userDataDir);
    expect(before.map((r) => r.path)).toContain(file);

    lockFolder(locked);
    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectOnlyCollection(window);
    await rowAt(window, locked).click();
    await expect(rowAt(window, file).getByTestId('unavailable')).toHaveText('unavailable');
    await rowAt(window, file).click();
    await expect(rowAt(window, file)).toHaveAttribute('aria-selected', 'true');
    await expect(filePath(window)).toHaveText(file);
    await expect(revealBtn(window)).toBeEnabled();

    await revealBtn(window).click();
    await expect.poll(async () =>
      (await revealCalls(app)).length > 0 || (await revealError(window).isVisible()), { timeout: 15000 }).toBe(true);
    const calls = await revealCalls(app);
    const errorText = (await revealError(window).isVisible()) ? await revealError(window).textContent() : '';
    const outcome = calls.length === 1 ? 'revealed' : errorText.includes('File not found') ? 'not-found' : 'other';
    const description = `chmod 000 folder, stored file lstat outcome: ${outcome}; calls=${JSON.stringify(calls)}; error=${JSON.stringify(errorText)}`;
    console.log(`[reveal-errors] ${description}`);
    test.info().annotations.push({ type: 'observed-outcome', description });

    expect(calls).toEqual([]);
    expect(errorText).toContain("Can't check this file: permission denied (EACCES)");
    expect(errorText).toContain(file);
    expect(errorText).not.toContain('File not found');
    await expect(rowAt(window, file)).toHaveAttribute('aria-selected', 'true');
    await expect(rowAt(window, file).getByTestId('unavailable')).toHaveText('unavailable');

    await session.app.close();
    session = null;
    unlockFolder(locked);
    expect(storedIndex(userDataDir)).toEqual(before);
  } finally {
    if (session) await session.app.close().catch(() => {});
    try { unlockFolder(locked); } catch { /* the folder may already be gone */ }
    cleanupFixtureTree(fixture.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('unindexed: a failed revealFile for a path outside the index leaves the displayed path, selection and button state unchanged and records no call', async () => {
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-reveal-errors-outside-'));
  const outsideFile = path.join(outsideDir, 'not-indexed.txt');
  fs.writeFileSync(outsideFile, 'x');
  try {
    await withSeededApp('unindexed', ['a.jpg', 'b.jpg'], async ({ app, window }, base) => {
      const a = `${base}/a.jpg`;
      await selectFile(window, base, a);

      const rejected = await window.evaluate((p) => window.mediaOrganizer.revealFile(p), outsideFile);
      expect(rejected).toMatchObject({ ok: false, code: 'NOT_INDEXED' });

      expect(await revealCalls(app)).toEqual([]);
      expect(await filePath(window).textContent()).toBe(a);
      await expect(rowAt(window, a)).toHaveAttribute('aria-selected', 'true');
      await expect(selectedRows(window)).toHaveCount(1);
      await expect(revealBtn(window)).toBeEnabled();
      await expect(revealError(window)).toBeHidden();

      // The button still works for the selected file afterwards.
      await revealBtn(window).click();
      await expect.poll(() => revealCalls(app)).toEqual([a]);
    });
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

/*
 * Rescan after a reveal error, with the selected file's node still in the tree. Read from
 * src/renderer/file-detail.js, rescan-button.js and tree-view.js: Rescan calls TreeView.update,
 * which keeps selectedId when the node id is in the rebuilt tree and dispatches no file-selected
 * event, but does dispatch tree-updated, on which file-detail.js clears the reveal error. So the
 * selection and path are kept and the error is cleared.
 * To keep the node, the file is put back on disk before Rescan (a rescan with the file still
 * missing drops its node, which is the FR-12 clearing case, not this one).
 */
test('rescan with the selected file back on disk: selection and path are kept, no file-selected is announced, and the reveal error is cleared', async () => {
  await withSeededApp('rescan', ['a.jpg', 'b.jpg'], async ({ app, window }, base) => {
    const a = `${base}/a.jpg`;
    await selectFile(window, base, a);

    fs.rmSync(a);
    const errorBefore = await revealExpectingError(window);
    expect(errorBefore).toContain(a);
    expect(await revealCalls(app)).toEqual([]);

    fs.writeFileSync(a, 'back on disk\n');
    await window.evaluate(() => {
      window.__fileSelected = [];
      document.addEventListener('file-selected', (e) => window.__fileSelected.push(e.detail));
    });

    await window.getByTestId('rescan').click();
    await expect(window.getByTestId('rescan-status')).toContainText('Rescanned');

    expect(await window.evaluate(() => window.__fileSelected)).toEqual([]);
    await expect(rowAt(window, a)).toHaveCount(1);
    await expect(rowAt(window, a)).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
    await expect(filePath(window)).toHaveText(a);
    await expect(revealBtn(window)).toBeEnabled();
    await expect(revealError(window)).toBeHidden();
    expect(await revealError(window).textContent()).toBe('');
    expect(await revealCalls(app)).toEqual([]);

    // The next Reveal succeeds (the file exists).
    await revealBtn(window).click();
    await expect.poll(() => revealCalls(app)).toEqual([a]);
    await expect(revealError(window)).toBeHidden();
  });
});

// FR-12 counterpart: a rescan that finds the file still missing removes its node, so the
// selection is cleared (FR-5) and the error is cleared by the null file-selected event.
test('rescan with the selected file still missing: the node is gone, the selection is cleared, and the error is cleared', async () => {
  await withSeededApp('rescan-gone', ['a.jpg', 'b.jpg'], async ({ app, window }, base) => {
    const a = `${base}/a.jpg`;
    await selectFile(window, base, a);
    fs.rmSync(a);
    expect(await revealExpectingError(window)).toContain(a);

    await window.getByTestId('rescan').click();
    await expect(window.getByTestId('rescan-status')).toContainText('Rescanned');
    await expect(rowAt(window, a)).toHaveCount(0);
    await expect(selectedRows(window)).toHaveCount(0);
    await expect(revealBtn(window)).toBeDisabled();
    await expect(revealError(window)).toBeHidden();
    expect(await revealCalls(app)).toEqual([]);
  });
});

/*
 * FR-9: a showing reveal error is cleared when the selection changes to another file. Clicking a
 * file row calls selectFile, which dispatches file-selected, and file-detail.js render() clears the
 * error on it.
 *
 * Second half, reasoned from reading the code, not from a separate observation: a folder row click
 * runs setFocus + toggle -> relayout, which dispatches neither file-selected nor tree-updated (only
 * selectFile and replaceTree, i.e. show/update, do). file-detail.js clears the error only on those
 * two events, so the selection, the path AND the error all stay as they were. This assertion relies
 * on that; if folder clicks ever start announcing an event, it will fail on the error check.
 */
test('selecting another file clears a showing reveal error; clicking a folder row changes neither selection, path nor error', async () => {
  await withSeededApp('fr9', ['a.jpg', 'b.jpg', 'sub/c.jpg'], async ({ app, window }, base) => {
    const a = `${base}/a.jpg`;
    const b = `${base}/b.jpg`;
    const sub = `${base}/sub`;
    await selectFile(window, base, a);

    fs.rmSync(a);
    const errorText = await revealExpectingError(window);
    expect(errorText).toContain(a);
    expect(await revealCalls(app)).toEqual([]);

    // Folder click while the error shows: selection, path and (per the code) the error are kept.
    await rowAt(window, sub).click();
    await expect(rowAt(window, `${sub}/c.jpg`)).toHaveCount(1); // the folder did expand
    await expect(rowAt(window, a)).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
    await expect(filePath(window)).toHaveText(a);
    await expect(revealError(window)).toBeVisible();
    expect(await revealError(window).textContent()).toBe(errorText);

    // Selecting another file clears the error.
    await rowAt(window, b).click();
    await expect(rowAt(window, b)).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
    await expect(filePath(window)).toHaveText(b);
    await expect(revealError(window)).toBeHidden();
    expect(await revealError(window).textContent()).toBe('');
    await expect(revealBtn(window)).toBeEnabled();
    expect(await revealCalls(app)).toEqual([]);
  });
});
