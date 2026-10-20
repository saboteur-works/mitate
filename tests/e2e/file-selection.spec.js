'use strict';

/*
 * File selection e2e (Feature 2, Task 6). Collections are written to
 * <userDataDir>/store.json before launch (real service + scanner for the
 * fixture tree; openStorage directly for seeded collections), as in
 * tree-view.spec.js and rescan.spec.js.
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

function fileRecord(folderPath, rel) {
  const name = rel.split('/').pop();
  const { extension, kind, subtype } = lookupFileName(name);
  return { path: `${folderPath}/${rel}`, relativePath: rel, name, extension, kind, ...(subtype ? { subtype } : {}) };
}

// folders = [{ id, path, files: [rel, ...] }]
function seedCollection(userDataDir, name, folders) {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  storage.putCollection({
    id: 'col-1',
    name,
    folderIds: folders.map((f) => f.id),
    createdAt: new Date().toISOString(),
  });
  for (const f of folders) {
    storage.putFolder({ id: f.id, collectionId: 'col-1', path: f.path, unavailable: false });
    storage.replaceFolderIndex(f.id, f.files.map((rel) => fileRecord(f.path, rel)));
  }
}

// Records every file-selected event on document into window.__fileSelected.
const recordEvents = (window) =>
  window.evaluate(() => {
    window.__fileSelected = [];
    document.addEventListener('file-selected', (e) => window.__fileSelected.push(e.detail));
  });
const events = (window) => window.evaluate(() => window.__fileSelected);

const selectedRows = (window) => window.locator('[data-testid="tree-row"][aria-selected="true"]');

// Rendered rows as [nodeId, aria-expanded] pairs ordered by data-index.
const snapshot = (window) =>
  window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"]')]
      .map((r) => ({ i: Number(r.dataset.index), id: r.dataset.nodeId, exp: r.getAttribute('aria-expanded') }))
      .sort((a, b) => a.i - b.i)
      .map((r) => [r.id, r.exp]),
  );

test('clicking a file selects it alone, announces it, and leaves rows and folders unchanged; a folder click keeps the selection', async () => {
  const userDataDir = newUserDataDir('select-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  const docs = `${root}/Docs`;
  const report = `${docs}/report.pdf`;
  const topFile = `${root}/top.mp3`;
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Select', [root]);

    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);
    await recordEvents(window);
    await rowAt(window, root).click();
    await rowAt(window, docs).click();
    await expect(rowAt(window, report)).toHaveCount(1);
    await expect(rowAt(window, topFile)).toHaveCount(1);
    await expect(selectedRows(window)).toHaveCount(0);
    expect(await events(window)).toEqual([]);

    // First file: selected state on that row only; rows and folders unchanged.
    const before = await snapshot(window);
    await rowAt(window, report).click();
    await expect(rowAt(window, report)).toHaveAttribute('aria-selected', 'true');
    await expect(rowAt(window, report)).toHaveClass(/tree-selected/);
    await expect(selectedRows(window)).toHaveCount(1);
    await expect(window.locator('.tree-selected')).toHaveCount(1);
    expect(await snapshot(window)).toEqual(before);
    await expect(rowAt(window, docs)).toHaveAttribute('aria-expanded', 'true');

    // The event carries the row's path and node id.
    const reportId = await rowAt(window, report).getAttribute('data-node-id');
    let seen = await events(window);
    expect(seen).toHaveLength(1);
    expect(seen[0].file.path).toBe(await rowAt(window, report).getAttribute('data-path'));
    expect(seen[0].file.path).toBe(report);
    expect(seen[0].file.nodeId).toBe(reportId);

    // Second file: the selected state moves; exactly one row is selected.
    await rowAt(window, topFile).click();
    await expect(rowAt(window, topFile)).toHaveAttribute('aria-selected', 'true');
    await expect(rowAt(window, topFile)).toHaveClass(/tree-selected/);
    await expect(rowAt(window, report)).not.toHaveAttribute('aria-selected', 'true');
    await expect(rowAt(window, report)).not.toHaveClass(/tree-selected/);
    await expect(selectedRows(window)).toHaveCount(1);
    expect(await snapshot(window)).toEqual(before);
    seen = await events(window);
    expect(seen).toHaveLength(2);
    expect(seen[1].file.path).toBe(topFile);
    expect(seen[1].file.nodeId).toBe(await rowAt(window, topFile).getAttribute('data-node-id'));

    // A folder click still collapses/expands and does not alter the selection or emit an event.
    await rowAt(window, docs).click();
    await expect(rowAt(window, docs)).toHaveAttribute('aria-expanded', 'false');
    await expect(rowAt(window, report)).toHaveCount(0);
    await expect(rowAt(window, topFile)).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
    await rowAt(window, docs).click();
    await expect(rowAt(window, docs)).toHaveAttribute('aria-expanded', 'true');
    await expect(rowAt(window, report)).toHaveCount(1);
    await expect(rowAt(window, topFile)).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);
    expect(await events(window)).toHaveLength(2);
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('the selection survives scrolling the selected row out of and back into the virtual window', async () => {
  const userDataDir = newUserDataDir('select-e2e');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-select-scroll-'));
  const files = Array.from({ length: 300 }, (_, i) => `f${String(i).padStart(3, '0')}.jpg`);
  let session;
  try {
    seedCollection(userDataDir, 'Many', [{ id: 'f-many', path: base, files }]);
    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);
    await recordEvents(window);
    await rowAt(window, base).click();
    const first = `${base}/${files[0]}`;
    await rowAt(window, first).click();
    await expect(rowAt(window, first)).toHaveAttribute('aria-selected', 'true');

    // The focused row is always rendered (Task 8) and a click focuses the row, so move focus to
    // the next row (ArrowDown moves focus only, it does not select) before scrolling away.
    const view = window.getByTestId('tree-view');
    await view.press('ArrowDown');
    await expect(rowAt(window, `${base}/${files[1]}`)).toHaveClass(/tree-focused/);
    await expect(rowAt(window, first)).toHaveAttribute('aria-selected', 'true');
    await view.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(rowAt(window, first)).toHaveCount(0);
    await expect(selectedRows(window)).toHaveCount(0);

    await view.evaluate((el) => { el.scrollTop = 0; });
    await expect(rowAt(window, first)).toHaveCount(1);
    await expect(rowAt(window, first)).toHaveAttribute('aria-selected', 'true');
    await expect(rowAt(window, first)).toHaveClass(/tree-selected/);
    await expect(selectedRows(window)).toHaveCount(1);
    expect(await events(window)).toHaveLength(1);
  } finally {
    if (session) await session.app.close();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// Roots <base>/a and <base>/a/b: root a's index has b/same.jpg, so root b drops same.jpg and the
// shared file appears once, under the outer root (Feature 3 FR-9; Feature 2 OQ-8).
test('overlapping roots: the shared file appears once, under the outer root, and selecting it selects one row', async () => {
  const userDataDir = newUserDataDir('select-e2e');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-select-overlap-'));
  const rootA = path.join(base, 'a');
  const rootB = path.join(base, 'a', 'b');
  fs.mkdirSync(rootB, { recursive: true });
  let session;
  try {
    seedCollection(userDataDir, 'Overlap', [
      { id: 'f-a', path: rootA, files: ['b/same.jpg'] },
      { id: 'f-b', path: rootB, files: ['same.jpg'] },
    ]);
    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);
    await recordEvents(window);

    const byId = (id) => window.locator(`[data-testid="tree-row"][data-node-id="${id}"]`);
    await byId('f-a:').click();
    await byId('f-a:b').click();
    await byId('f-b:').click();
    const shared = `${rootB}/same.jpg`;
    await expect(byId('f-a:b/same.jpg')).toHaveAttribute('data-path', shared);
    // The inner root is still shown, but the outer root owns the shared file (FR-9).
    await expect(byId('f-b:')).toHaveCount(1);
    await expect(byId('f-b:same.jpg')).toHaveCount(0);
    await expect(window.locator(`[data-testid="tree-row"][data-path="${shared}"]`)).toHaveCount(1);

    await byId('f-a:b/same.jpg').click();
    await expect(byId('f-a:b/same.jpg')).toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);

    const seen = await events(window);
    expect(seen.map((d) => d.file.nodeId)).toEqual(['f-a:b/same.jpg']);
    expect(seen[0].file.path).toBe(shared);
  } finally {
    if (session) await session.app.close();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

const lastEvent = async (window) => {
  const seen = await events(window);
  return seen[seen.length - 1];
};

// Task 7 (FR-12): Rescan calls TreeView.update, selecting a collection calls TreeView.show.
test('Rescan keeps the selection when the node still exists and clears it, announcing null, when the file is gone', async () => {
  const userDataDir = newUserDataDir('select-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  const docs = `${root}/Docs`;
  const report = `${docs}/report.pdf`;
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Refresh', [root]);

    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);
    await recordEvents(window);
    await rowAt(window, root).click();
    await rowAt(window, docs).click();
    await rowAt(window, report).click();
    await expect(rowAt(window, report)).toHaveAttribute('aria-selected', 'true');
    const reportId = await rowAt(window, report).getAttribute('data-node-id');
    expect(await events(window)).toHaveLength(1);

    // No change on disk: the same row is still selected and the last event still has the file.
    await window.getByTestId('rescan').click();
    await expect(window.getByTestId('rescan-status')).toContainText('Rescanned 1 folders');
    await expect(rowAt(window, report)).toHaveAttribute('aria-selected', 'true');
    await expect(rowAt(window, report)).toHaveClass(/tree-selected/);
    await expect(selectedRows(window)).toHaveCount(1);
    expect(await rowAt(window, report).getAttribute('data-node-id')).toBe(reportId);
    const kept = await lastEvent(window);
    expect(kept.file.path).toBe(report);
    expect(kept.file.nodeId).toBe(reportId);

    // The selected file is deleted on disk: after Rescan no row is selected and null is announced.
    fs.rmSync(path.join(docs, 'report.pdf'));
    await window.getByTestId('rescan').click();
    await expect(rowAt(window, report)).toHaveCount(0);
    await expect(selectedRows(window)).toHaveCount(0);
    await expect(window.locator('.tree-selected')).toHaveCount(0);
    expect((await lastEvent(window)).file).toBeNull();
    expect((await events(window)).filter((d) => d.file === null)).toHaveLength(1);
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('selecting another collection clears the selection and announces null', async () => {
  const userDataDir = newUserDataDir('select-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-select-other-'));
  fs.writeFileSync(path.join(other, 'other.jpg'), 'other\n');
  const report = `${root}/Docs/report.pdf`;
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    const service = createCollectionService({ storage });
    await service.createCollection('First', [root]);
    await service.createCollection('Second', [other]);

    session = await launchApp(userDataDir);
    const { window } = session;
    const item = (name) => window.getByTestId('collection-item').filter({ hasText: name });
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
    await item('First').click();
    await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
    await recordEvents(window);
    await rowAt(window, root).click();
    await rowAt(window, `${root}/Docs`).click();
    await rowAt(window, report).click();
    await expect(selectedRows(window)).toHaveCount(1);

    await item('Second').click();
    await expect(rowAt(window, other)).toHaveCount(1);
    await expect(selectedRows(window)).toHaveCount(0);
    expect((await lastEvent(window)).file).toBeNull();
    expect(await events(window)).toHaveLength(2);

    // With nothing selected, showing a collection announces nothing more.
    await item('First').click();
    await expect(rowAt(window, root)).toHaveCount(1);
    await expect(selectedRows(window)).toHaveCount(0);
    expect(await events(window)).toHaveLength(2);
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(other, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// The collection is rebuilt: the same file path now sits under a different root folder id, so the
// node id differs. The rebuilt records are passed to TreeView.update directly (the shape the
// collections view returns).
test('a file whose path survives but whose node id changed is not kept by update', async () => {
  const userDataDir = newUserDataDir('select-e2e');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-select-rebuilt-'));
  let session;
  try {
    seedCollection(userDataDir, 'Rebuilt', [{ id: 'f-old', path: base, files: ['same.jpg'] }]);
    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);
    await recordEvents(window);
    await rowAt(window, base).click();
    const file = `${base}/same.jpg`;
    await rowAt(window, file).click();
    await expect(rowAt(window, file)).toHaveAttribute('aria-selected', 'true');
    expect((await lastEvent(window)).file.nodeId).toBe('f-old:same.jpg');

    await window.evaluate((p) => {
      const rec = {
        folderId: 'f-new', collectionId: 'col-1', path: `${p}/same.jpg`, relativePath: 'same.jpg',
        name: 'same.jpg', extension: 'jpg', kind: 'image',
      };
      window.TreeView.update([{ id: 'f-new', collectionId: 'col-1', path: p, unavailable: false }], [rec]);
    }, base);

    // Expansion is keyed by node id, so the new root f-new starts collapsed: expand it.
    await rowAt(window, base).click();
    await expect(window.locator('[data-testid="tree-row"][data-node-id="f-new:same.jpg"]')).toHaveCount(1);
    await expect(rowAt(window, file)).toHaveAttribute('data-node-id', 'f-new:same.jpg');
    await expect(rowAt(window, file)).not.toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(0);
    expect((await lastEvent(window)).file).toBeNull();
  } finally {
    if (session) await session.app.close();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
