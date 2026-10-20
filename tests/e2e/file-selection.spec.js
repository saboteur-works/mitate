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

    const view = window.getByTestId('tree-view');
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

// Roots <base>/a and <base>/a/b: the file same.jpg of root b and the file b/same.jpg of root a
// have the same data-path, so only the node id tells them apart.
test('overlapping roots showing the same path: only the clicked row is selected', async () => {
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
    await expect(byId('f-b:same.jpg')).toHaveAttribute('data-path', shared);

    await byId('f-b:same.jpg').click();
    await expect(byId('f-b:same.jpg')).toHaveAttribute('aria-selected', 'true');
    await expect(byId('f-a:b/same.jpg')).not.toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);

    await byId('f-a:b/same.jpg').click();
    await expect(byId('f-a:b/same.jpg')).toHaveAttribute('aria-selected', 'true');
    await expect(byId('f-b:same.jpg')).not.toHaveAttribute('aria-selected', 'true');
    await expect(selectedRows(window)).toHaveCount(1);

    const seen = await events(window);
    expect(seen.map((d) => d.file.nodeId)).toEqual(['f-b:same.jpg', 'f-a:b/same.jpg']);
    expect(seen.every((d) => d.file.path === shared)).toBe(true);
  } finally {
    if (session) await session.app.close();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
