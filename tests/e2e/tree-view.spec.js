'use strict';

/*
 * Tree view e2e (Task 14). The store file is written BEFORE the app launches:
 * main.js opens openStorage({ location: { baseDir: app.getPath('userData') } })
 * and --user-data-dir makes userData the temp dir, so the app reads
 * <userDataDir>/store.json. Seeding uses the real openStorage module (and, for
 * the fixture collection, the real service + scanner).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const ROW_HEIGHT = 24;
// Fixed bound unrelated to the index size: viewport (400px) holds ~17 rows,
// plus a 5-row buffer on each side, at up to 3 elements per row.
const MAX_ROWS = 200;
const MAX_TREE_NODES = 200;
const LARGE_COUNT = 50000;

function newUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-tree-e2e-'));
}

function fileRecord(folderPath, rel) {
  const name = rel.split('/').pop();
  const dot = name.lastIndexOf('.');
  return {
    path: `${folderPath}/${rel}`,
    relativePath: rel,
    name,
    extension: dot >= 0 ? name.slice(dot + 1).toLowerCase() : '',
    kind: 'image',
  };
}

// Seeds one collection: folders = [{ id, path, unavailable, files: [rel, ...] }].
function seedCollection(userDataDir, name, folders, collectionId = 'col-1') {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  storage.putCollection({
    id: collectionId,
    name,
    folderIds: folders.map((f) => f.id),
    createdAt: new Date().toISOString(),
  });
  for (const f of folders) {
    storage.putFolder({ id: f.id, collectionId, path: f.path, unavailable: f.unavailable });
    storage.replaceFolderIndex(f.id, f.files.map((rel) => fileRecord(f.path, rel)));
  }
}

async function launch(userDataDir) {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: path.join(__dirname, '..', '..'),
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

const rowAt = (window, p) => window.locator(`[data-testid="tree-row"][data-path="${p}"]`);
const rowIndex = async (window, p) => Number(await rowAt(window, p).getAttribute('data-index'));

async function selectFirstCollection(window) {
  await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
  await window.getByTestId('collection-item').click();
  await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
}

async function domCounts(window) {
  return window.evaluate(() => {
    const view = document.querySelector('[data-testid="tree-view"]');
    return {
      rows: view.querySelectorAll('[data-testid="tree-row"]').length,
      nodes: view.querySelectorAll('*').length,
    };
  });
}

test('fixture collection renders a tree mirroring the disk structure, folders before files', async () => {
  const userDataDir = newUserDataDir();
  const fixture = buildFixtureTree();
  const root = fixture.root;
  let session;
  try {
    const storage = openStorage({ location: { baseDir: userDataDir } });
    await createCollectionService({ storage }).createCollection('Fixture', [root]);

    session = await launch(userDataDir);
    const { window } = session;
    await selectFirstCollection(window);

    // Roots start collapsed: exactly the root row is shown.
    await expect(window.getByTestId('tree-row')).toHaveCount(1);
    await expect(rowAt(window, root)).toContainText(path.basename(root));
    await expect(rowAt(window, root)).toHaveAttribute('data-expanded', 'false');
    await expect(window.getByTestId('unavailable')).toHaveCount(0);

    // Expand the root: folders come before files, each group in name order.
    await rowAt(window, root).click();
    const docs = `${root}/Docs`;
    const music = `${root}/Music`;
    const photos = `${root}/Photos`;
    const topFile = `${root}/top.mp3`;
    await expect(rowAt(window, topFile)).toHaveCount(1);
    const [iDocs, iMusic, iPhotos, iTop] = [
      await rowIndex(window, docs),
      await rowIndex(window, music),
      await rowIndex(window, photos),
      await rowIndex(window, topFile),
    ];
    expect(iDocs).toBeLessThan(iMusic);
    expect(iMusic).toBeLessThan(iPhotos);
    expect(iPhotos).toBeLessThan(iTop);
    await expect(rowAt(window, topFile)).toContainText('top.mp3');
    await expect(rowAt(window, topFile)).toHaveAttribute('data-type', 'file');
    await expect(rowAt(window, photos)).toHaveAttribute('data-type', 'folder');

    // Expand Photos > 2024 > Trip > Day1 and see the deep file.
    for (const rel of ['Photos', 'Photos/2024', 'Photos/2024/Trip', 'Photos/2024/Trip/Day1']) {
      await rowAt(window, `${root}/${rel}`).click();
    }
    const deep = `${root}/Photos/2024/Trip/Day1/deep.jpg`;
    await expect(rowAt(window, deep)).toContainText('deep.jpg');
    await expect(rowAt(window, deep)).toHaveAttribute('data-type', 'file');
    await expect(rowAt(window, `${root}/Photos/2024/Trip/c.heic`)).toContainText('c.heic');
    await expect(rowAt(window, `${root}/Photos/2024/b.png`)).toContainText('b.png');
    await expect(rowAt(window, `${root}/Photos/A.JPG`)).toContainText('A.JPG');

    // Subfolders precede sibling files, and nesting follows the disk order.
    const order = [
      photos,
      `${root}/Photos/2024`,
      `${root}/Photos/2024/Trip`,
      `${root}/Photos/2024/Trip/Day1`,
      deep,
      `${root}/Photos/2024/Trip/c.heic`,
      `${root}/Photos/2024/b.png`,
      `${root}/Photos/A.JPG`,
    ];
    const indices = [];
    for (const p of order) indices.push(await rowIndex(window, p));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));

    // Day1 holds a second supported file, named by the fixture manifest.
    const notesRel = 'Photos/2024/Trip/Day1/notes.txt';
    expect(fixture.manifest.supportedFiles).toContain(notesRel);
    const notes = `${root}/${notesRel}`;
    await expect(rowAt(window, notes)).toContainText(path.basename(notesRel));
    await expect(rowAt(window, notes)).toHaveAttribute('data-type', 'file');
    expect(await rowIndex(window, notes)).toBeGreaterThan(await rowIndex(window, deep));

    // Unsupported files are not part of the tree: expand Docs, where the supported
    // sibling report.pdf is present and the unsupported data.xyz is absent.
    await rowAt(window, docs).click();
    await expect(rowAt(window, `${docs}/report.pdf`)).toContainText('report.pdf');
    await expect(rowAt(window, `${docs}/data.xyz`)).toHaveCount(0);
    // Nothing is marked unavailable.
    await expect(window.getByTestId('unavailable')).toHaveCount(0);
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a 50,000-file index renders a bounded number of DOM nodes and scrolls', async () => {
  test.setTimeout(180000);
  const userDataDir = newUserDataDir();
  const folderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-tree-large-'));
  let session;
  try {
    const files = [];
    for (let i = 0; i < LARGE_COUNT; i++) files.push(`IMG_${i}.jpg`);
    seedCollection(userDataDir, 'Large', [{ id: 'f-large', path: folderPath, unavailable: false, files }]);

    session = await launch(userDataDir);
    const { window } = session;
    await selectFirstCollection(window);

    // Collapsed: only the root row.
    expect((await domCounts(window)).rows).toBe(1);

    // Expand the folder: 50,001 logical rows, a bounded number in the DOM.
    await rowAt(window, folderPath).click();
    await expect(window.getByTestId('tree-row').nth(5)).toBeVisible();
    // Record raw values first; the cause of any mismatch is read from these.
    const heights = await window.evaluate(() => {
      const spacer = document.querySelector('[data-testid="tree-spacer"]');
      const view = document.querySelector('[data-testid="tree-view"]');
      return {
        styleHeight: spacer.style.height,
        rectHeight: spacer.getBoundingClientRect().height,
        scrollHeight: view.scrollHeight,
      };
    });
    test.info().annotations.push({ type: 'raw-heights', description: JSON.stringify(heights) });
    console.log(`tree-view raw heights for ${LARGE_COUNT} files: ${JSON.stringify(heights)}`);
    const expectedHeight = (LARGE_COUNT + 1) * ROW_HEIGHT;
    expect(Math.round(heights.rectHeight)).toBeGreaterThanOrEqual(expectedHeight - ROW_HEIGHT);
    expect(Math.round(heights.rectHeight)).toBeGreaterThan(1000000);
    expect(heights.scrollHeight).toBeGreaterThanOrEqual(expectedHeight - ROW_HEIGHT);
    expect(heights.scrollHeight).toBeGreaterThan(1000000);
    const atTop = await domCounts(window);
    await expect(rowAt(window, `${folderPath}/IMG_0.jpg`)).toContainText('IMG_0.jpg');
    // IMG_2 sorts before IMG_10 (natural order) and far-away rows are not in the DOM.
    expect(await rowIndex(window, `${folderPath}/IMG_2.jpg`)).toBeLessThan(
      await rowIndex(window, `${folderPath}/IMG_10.jpg`),
    );
    await expect(rowAt(window, `${folderPath}/IMG_30000.jpg`)).toHaveCount(0);

    // Scroll to the middle: rows around index 25,000 render (row i is IMG_{i-1}).
    await window.evaluate((top) => { document.querySelector('[data-testid="tree-view"]').scrollTop = top; }, 25000 * ROW_HEIGHT);
    const middle = rowAt(window, `${folderPath}/IMG_24999.jpg`);
    await expect(middle).toHaveCount(1);
    await expect(middle).toContainText('IMG_24999.jpg');
    await expect(middle).toHaveAttribute('data-index', '25000');
    const inMiddle = await domCounts(window);

    // Scroll to the end.
    await window.evaluate(() => {
      const view = document.querySelector('[data-testid="tree-view"]');
      view.scrollTop = view.scrollHeight;
    });
    const last = rowAt(window, `${folderPath}/IMG_${LARGE_COUNT - 1}.jpg`);
    await expect(last).toHaveCount(1);
    await expect(last).toContainText(`IMG_${LARGE_COUNT - 1}.jpg`);
    const atEnd = await domCounts(window);

    for (const c of [atTop, inMiddle, atEnd]) {
      expect(c.rows).toBeGreaterThan(5);
      expect(c.rows).toBeLessThan(MAX_ROWS);
      expect(c.nodes).toBeLessThan(MAX_TREE_NODES);
    }
    const measured = { atTop, inMiddle, atEnd };
    test.info().annotations.push({ type: 'measured-dom', description: JSON.stringify(measured) });
    console.log(`tree-view DOM counts for ${LARGE_COUNT} files: ${JSON.stringify(measured)}`);
  } finally {
    if (session) await session.app.close();
    fs.rmSync(folderPath, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('unavailable folders keep their files, marked unavailable; unavailable empty roots are shown', async () => {
  const userDataDir = newUserDataDir();
  const present = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-tree-present-'));
  const missingWith = path.join(userDataDir, 'missing', 'gone-with-files');
  const missingEmpty = path.join(userDataDir, 'missing', 'gone-empty');
  let session;
  try {
    seedCollection(userDataDir, 'Mixed', [
      { id: 'f-with', path: missingWith, unavailable: false, files: ['a.jpg', 'sub/b.jpg'] },
      { id: 'f-empty', path: missingEmpty, unavailable: false, files: [] },
      { id: 'f-present', path: present, unavailable: false, files: ['ok.jpg'] },
    ]);

    session = await launch(userDataDir);
    const { window } = session;
    await selectFirstCollection(window);

    // All three roots are shown, including the unavailable one with no files.
    await expect(window.getByTestId('tree-row')).toHaveCount(3);
    const marker = (p) => rowAt(window, p).getByTestId('unavailable');
    await expect(marker(missingEmpty)).toHaveText('unavailable');
    await expect(marker(missingWith)).toHaveText('unavailable');
    await expect(marker(present)).toHaveCount(0);

    // The empty unavailable root expands to nothing.
    await rowAt(window, missingEmpty).click();
    await expect(window.getByTestId('tree-row')).toHaveCount(3);

    // Expanding the unavailable root shows its stored files, each marked.
    await rowAt(window, missingWith).click();
    await expect(rowAt(window, `${missingWith}/a.jpg`)).toContainText('a.jpg');
    await expect(marker(`${missingWith}/a.jpg`)).toHaveText('unavailable');
    await expect(marker(`${missingWith}/sub`)).toHaveText('unavailable');
    await rowAt(window, `${missingWith}/sub`).click();
    await expect(rowAt(window, `${missingWith}/sub/b.jpg`)).toContainText('b.jpg');
    await expect(marker(`${missingWith}/sub/b.jpg`)).toHaveText('unavailable');

    // A file under the available root is not marked.
    await rowAt(window, present).click();
    await expect(rowAt(window, `${present}/ok.jpg`)).toContainText('ok.jpg');
    await expect(marker(`${present}/ok.jpg`)).toHaveCount(0);
  } finally {
    if (session) await session.app.close();
    fs.rmSync(present, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// Overlapping roots <tmp>/a and <tmp>/a/b are both kept. The root <tmp>/a/b and the
// subfolder b under root <tmp>/a share data-path, so rows are addressed by data-node-id
// (<rootFolderId>:<relativePath>) and expansion state must be independent.
test('overlapping roots: the root /a/b and the subfolder b under root /a expand independently', async () => {
  const userDataDir = newUserDataDir();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-tree-overlap-'));
  const rootA = path.join(base, 'a');
  const rootB = path.join(base, 'a', 'b');
  fs.mkdirSync(rootB, { recursive: true });
  let session;
  try {
    seedCollection(userDataDir, 'Overlap', [
      { id: 'f-a', path: rootA, unavailable: false, files: ['b/inA.jpg'] },
      { id: 'f-b', path: rootB, unavailable: false, files: ['inB.jpg'] },
    ]);

    session = await launch(userDataDir);
    const { window } = session;
    await selectFirstCollection(window);

    const byId = (id) => window.locator(`[data-testid="tree-row"][data-node-id="${id}"]`);
    const idRootA = 'f-a:';
    const idRootB = 'f-b:';
    const idSubB = 'f-a:b';

    // Both roots render, with distinct node ids, and they share no expansion.
    await expect(window.getByTestId('tree-row')).toHaveCount(2);
    await expect(byId(idRootA)).toHaveCount(1);
    await expect(byId(idRootB)).toHaveCount(1);
    await expect(byId(idRootA)).toHaveAttribute('data-path', rootA);
    await expect(byId(idRootB)).toHaveAttribute('data-path', rootB);
    await expect(byId(idRootA)).toHaveAttribute('data-expanded', 'false');
    await expect(byId(idRootB)).toHaveAttribute('data-expanded', 'false');

    // Expanding the root /a/b shows its own file and leaves root /a collapsed.
    await byId(idRootB).click();
    await expect(byId(idRootB)).toHaveAttribute('data-expanded', 'true');
    await expect(byId('f-b:inB.jpg')).toHaveCount(1);
    await expect(byId(idRootA)).toHaveAttribute('data-expanded', 'false');
    await expect(byId(idSubB)).toHaveCount(0);

    // Expanding root /a shows the subfolder b (same path as root /a/b), still collapsed.
    await byId(idRootA).click();
    await expect(byId(idRootA)).toHaveAttribute('data-expanded', 'true');
    await expect(byId(idSubB)).toHaveCount(1);
    await expect(byId(idSubB)).toHaveAttribute('data-path', rootB);
    await expect(byId(idSubB)).toHaveAttribute('data-expanded', 'false');
    await expect(byId(idRootB)).toHaveAttribute('data-expanded', 'true');
    await expect(byId('f-a:b/inA.jpg')).toHaveCount(0);

    // Expanding the subfolder shows root a's file; collapsing the root /a/b leaves it expanded.
    await byId(idSubB).click();
    await expect(byId(idSubB)).toHaveAttribute('data-expanded', 'true');
    await expect(byId('f-a:b/inA.jpg')).toHaveCount(1);
    await byId(idRootB).click();
    await expect(byId(idRootB)).toHaveAttribute('data-expanded', 'false');
    await expect(byId('f-b:inB.jpg')).toHaveCount(0);
    await expect(byId(idSubB)).toHaveAttribute('data-expanded', 'true');
    await expect(byId('f-a:b/inA.jpg')).toHaveCount(1);
  } finally {
    if (session) await session.app.close();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

// The late response is produced in the main process: the getView handler is wrapped
// through ipcMain._invokeHandlers (Electron internal channel -> handler Map; the test
// fails loudly if absent, as in create-collection.spec.js) so each collection's reply
// waits on a gate the test releases. Gates make the arrival order deterministic.
for (const [first, second] of [['A', 'B'], ['B', 'A']]) {
  test(`a late view response for ${first} does not overwrite the tree of ${second}, clicked last`, async () => {
    const userDataDir = newUserDataDir();
    const pathOf = { A: path.join(userDataDir, 'missing', 'root-a'), B: path.join(userDataDir, 'missing', 'root-b') };
    let session;
    try {
      seedCollection(userDataDir, 'Alpha', [{ id: 'f-a', path: pathOf.A, unavailable: false, files: ['only-a.jpg'] }], 'col-a');
      seedCollection(userDataDir, 'Beta', [{ id: 'f-b', path: pathOf.B, unavailable: false, files: ['only-b.jpg'] }], 'col-b');

      session = await launch(userDataDir);
      const { app, window } = session;
      await app.evaluate(({ ipcMain }) => {
        const handlers = ipcMain._invokeHandlers;
        const original = handlers && handlers.get && handlers.get('collections:getView');
        if (typeof original !== 'function') {
          throw new Error('ipcMain._invokeHandlers has no collections:getView handler');
        }
        globalThis.__viewReleases = {};
        globalThis.__viewDone = [];
        handlers.set('collections:getView', async (event, collectionId) => {
          await new Promise((resolve) => { globalThis.__viewReleases[collectionId] = resolve; });
          const result = await original(event, collectionId);
          globalThis.__viewDone.push(collectionId);
          return result;
        });
      });
      const release = (id) => app.evaluate((_electron, cid) => globalThis.__viewReleases[cid](), id);
      const pending = (id) => app.evaluate((_electron, cid) => typeof globalThis.__viewReleases[cid] === 'function', id);
      const done = (id) => app.evaluate((_electron, cid) => globalThis.__viewDone.includes(cid), id);
      const item = (label) => window.getByTestId('collection-item').filter({ hasText: label });
      const idOf = { A: 'col-a', B: 'col-b' };
      const labelOf = { A: 'Alpha', B: 'Beta' };

      await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });
      await item(labelOf[first]).click();
      await expect.poll(() => pending(idOf[first])).toBe(true);
      await item(labelOf[second]).click();
      await expect.poll(() => pending(idOf[second])).toBe(true);

      // The last-clicked collection answers first and is shown.
      await release(idOf[second]);
      await expect(rowAt(window, pathOf[second])).toHaveCount(1);
      await expect(item(labelOf[second])).toHaveClass(/collection-selected/);

      // The earlier request answers late: its response must be discarded.
      await release(idOf[first]);
      await expect.poll(() => done(idOf[first])).toBe(true);
      await window.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await window.evaluate(() => new Promise((r) => setTimeout(r, 200)));

      await expect(rowAt(window, pathOf[first])).toHaveCount(0);
      await expect(rowAt(window, pathOf[second])).toHaveCount(1);
      await expect(window.getByTestId('tree-row')).toHaveCount(1);
      await expect(item(labelOf[second])).toHaveClass(/collection-selected/);
      await expect(item(labelOf[first])).not.toHaveClass(/collection-selected/);
      await rowAt(window, pathOf[second]).click();
      await expect(rowAt(window, `${pathOf[second]}/only-${second.toLowerCase()}.jpg`)).toHaveCount(1);
    } finally {
      if (session) await session.app.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
}
