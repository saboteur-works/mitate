'use strict';

/*
 * One appearance of a file in the type lists on legacy data e2e (Feature 4, Task 14; FR-2, FR-9,
 * FR-13). The UI no longer builds nested or identical roots (see dedup.spec.js), so these shapes
 * are seeded into <userDataDir>/store.json before launch as that spec does: two folder records of
 * one collection with the real scanner's records. Each list must show each file once, with the
 * paths the tree shows. The tree is virtualized, but this fixture is small enough that expanding
 * every rendered folder row renders all of it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp } = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');
const { KINDS, listRows, openList, selectCollection } = require('../support/type-views-ui.js');

// The indexed files of the fixture tree by kind (hidden files, package contents, symlinks and the
// unsupported readme.md and data.xyz are not indexed).
const REL = {
  image: ['Photos/A.JPG', 'Photos/2024/b.png', 'Photos/2024/Trip/c.heic', 'Photos/2024/Trip/Day1/deep.jpg'],
  audio: ['top.mp3', 'Music/Album/track01.flac'],
  video: [],
  document: ['Photos/2024/Trip/Day1/notes.txt', 'Docs/report.pdf'],
};

const storeOf = (userDataDir) => openStorage({ location: { baseDir: userDataDir } });

function storeSnapshot(userDataDir, collectionId) {
  const storage = storeOf(userDataDir);
  return {
    folderIds: storage.getCollection(collectionId).folderIds,
    folders: storage.listFolders(collectionId).map((f) => `${f.id} ${f.path}`).sort(),
    index: storage.getIndex({ collectionId }).map((r) => `${r.folderId} ${r.relativePath} ${r.path}`).sort(),
  };
}

// Writes a collection with two folder records, `firstPath` then `secondPath` in folderIds. Records
// come from the real scanner via a throwaway collection per folder; the ids are fresh.
async function seedLegacy(userDataDir, id, name, firstPath, secondPath) {
  const storage = storeOf(userDataDir);
  const service = createCollectionService({ storage });
  const copies = [];
  for (const dirPath of [firstPath, secondPath]) {
    const tmp = await service.createCollection('tmp', [dirPath]);
    const [folder] = storage.listFolders(tmp.collection.id);
    copies.push({ path: dirPath, records: storage.getIndex({ folderId: folder.id }) });
    storage.removeCollection(tmp.collection.id);
  }
  storage.putCollection({ id, name, folderIds: [], createdAt: new Date().toISOString() });
  copies.forEach((copy, i) => {
    storage.putFolder({ id: `${id}-folder-${i + 1}`, collectionId: id, path: copy.path, unavailable: false });
    storage.replaceFolderIndex(`${id}-folder-${i + 1}`, copy.records.map(({ folderId, collectionId: _c, ...rest }) => rest));
  });
}

async function expandRendered(window) {
  const collapsed = window.locator('[data-testid="tree-row"][data-type="folder"][data-expanded="false"]');
  while ((await collapsed.count()) > 0) await collapsed.first().click();
}

const treeFilePaths = async (window) =>
  (await window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"][data-type="file"]')].map((r) => r.dataset.path),
  )).sort();

// Opens every list of the selected collection; each file appears once; returns all paths, sorted.
async function listedPaths(window, root) {
  const all = [];
  for (const kind of KINDS) {
    const expected = REL[kind].map((rel) => `${root}/${rel}`).sort();
    await openList(window, kind, expected.length);
    const paths = (await listRows(window)).map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect([...paths].sort()).toEqual(expected);
    for (const p of expected) await expect(window.locator(`[data-testid="list-row"][data-path="${p}"]`)).toHaveCount(1);
    all.push(...paths);
  }
  return all.sort();
}

// The lists and the tree hold the same files, each once.
async function expectListsMatchTree(window, root) {
  const listed = await listedPaths(window, root);
  await window.getByTestId('view-tab-tree').click();
  await expandRendered(window);
  expect(await treeFilePaths(window)).toEqual(listed);
}

test('nested and identical roots (legacy): every list shows each file once and the lists match the tree', async () => {
  const userDataDir = newUserDataDir('type-dedup-e2e');
  const fx = buildFixtureTree();
  let session;
  try {
    await seedLegacy(userDataDir, 'nested', 'Nested', fx.root, `${fx.root}/Photos`);
    await seedLegacy(userDataDir, 'identical', 'Identical', fx.root, fx.root);
    const bytes = fs.readFileSync(`${userDataDir}/store.json`);

    session = await launchApp(userDataDir);
    const { window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(2, { timeout: 30000 });

    // Outer root and its subfolder: the inner root's files are in the lists once, none missing.
    await selectCollection(window, 'Nested');
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
    await expectListsMatchTree(window, fx.root);

    // The same path twice: each file once.
    await selectCollection(window, 'Identical');
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
    await expectListsMatchTree(window, fx.root);

    // Opening the lists wrote nothing.
    expect(fs.readFileSync(`${userDataDir}/store.json`).equals(bytes)).toBe(true);
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(fx.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('removing the outer root moves the inner root\'s files into the lists; the store changes only by the removal', async () => {
  const userDataDir = newUserDataDir('type-dedup-remove-e2e');
  const fx = buildFixtureTree();
  const inner = `${fx.root}/Photos`;
  let session;
  try {
    await seedLegacy(userDataDir, 'nested', 'Nested', fx.root, inner);
    const before = storeSnapshot(userDataDir, 'nested');
    const [outerId, innerId] = before.folderIds;

    session = await launchApp(userDataDir);
    const { app, window } = session;
    await selectCollection(window, 'Nested');
    await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
    await openList(window, 'image', REL.image.length);
    for (const row of await listRows(window)) {
      await expect(window.locator(`[data-testid="list-row"][data-path="${row.path}"]`)).toHaveAttribute('data-node-id', new RegExp(`^${outerId}:`));
    }
    await openList(window, 'audio', REL.audio.length);

    // Remove the outer root through the panel; the open list refreshes.
    await window.getByTestId('manage-folder').nth(0).getByTestId('remove-folder').click();
    await expect(window.getByTestId('manage-folder')).toHaveCount(1, { timeout: 30000 });
    // The open Audio list lost the files that only the outer root held.
    await expect(window.getByTestId('list-empty')).toHaveText('No audio files in this collection');
    await window.getByTestId('view-tab-image').click();
    await expect(window.getByTestId('list-row')).toHaveCount(REL.image.length);
    const images = await listRows(window);
    expect(images.map((r) => r.path).sort()).toEqual(REL.image.map((rel) => `${fx.root}/${rel}`).sort());
    for (const row of images) {
      await expect(window.locator(`[data-testid="list-row"][data-path="${row.path}"]`)).toHaveAttribute('data-node-id', new RegExp(`^${innerId}:`));
    }
    // Files that were only under the outer root are gone from the lists with it.
    await openList(window, 'document', 1);
    expect((await listRows(window)).map((r) => r.path)).toEqual([`${fx.root}/Photos/2024/Trip/Day1/notes.txt`]);

    await app.close();
    session = null;
    const after = storeSnapshot(userDataDir, 'nested');
    expect(after.folderIds).toEqual(before.folderIds.filter((id) => id !== outerId));
    expect(after.folders).toEqual(before.folders.filter((f) => !f.startsWith(`${outerId} `)));
    expect(after.index).toEqual(before.index.filter((r) => !r.startsWith(`${outerId} `)));
  } finally {
    if (session) await session.app.close().catch(() => {});
    cleanupFixtureTree(fx.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('folders whose paths differ only in case are two roots and both files are listed (case-sensitive volumes only)', async () => {
  const userDataDir = newUserDataDir('type-dedup-case-e2e');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-type-case-'));
  let session;
  try {
    fs.mkdirSync(path.join(base, 'Pics'));
    // On a case-insensitive volume 'pics' is the existing 'Pics' and mkdir fails with EEXIST.
    let caseSensitive = true;
    try {
      fs.mkdirSync(path.join(base, 'pics'));
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      caseSensitive = false;
    }
    if (!caseSensitive) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: `${os.tmpdir()} is case-insensitive: Pics and pics are one directory, so the pair cannot be built`,
      });
      test.skip(true, 'the temp volume is case-insensitive, so a case-differing folder pair does not exist on it');
    }
    fs.writeFileSync(path.join(base, 'Pics', 'one.jpg'), '1\n');
    fs.writeFileSync(path.join(base, 'pics', 'two.jpg'), '2\n');
    await seedLegacy(userDataDir, 'cased', 'Cased', `${base}/Pics`, `${base}/pics`);

    session = await launchApp(userDataDir);
    const { window } = session;
    await selectCollection(window, 'Cased');
    await openList(window, 'image', 2);
    expect((await listRows(window)).map((r) => r.path)).toEqual([`${base}/Pics/one.jpg`, `${base}/pics/two.jpg`]);
  } finally {
    if (session) await session.app.close().catch(() => {});
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
