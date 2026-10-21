'use strict';

/*
 * Type view controller e2e (Feature 4, Task 9; FR-1, FR-7, FR-9, FR-10, FR-11). Collections are created
 * through the UI (folder picker stubbed). The build counter and the loading probe are installed from
 * outside the app by tests/support/type-list-hooks.js, which wraps the renderer's TypeList.buildTypeList;
 * the app carries no test hook.
 */

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, stubFolderPicker } = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { installTypeListHooks, buildCounts, buildLog, setSortDelay } = require('../support/type-list-hooks.js');

const KINDS = ['image', 'audio', 'video', 'document'];

// The supported, indexed files of the fixture tree by kind (hidden files, package contents and
// symlinks are not indexed; .md and .xyz are unsupported).
const REL = {
  image: ['Photos/A.JPG', 'Photos/2024/b.png', 'Photos/2024/Trip/c.heic', 'Photos/2024/Trip/Day1/deep.jpg'],
  audio: ['top.mp3', 'Music/Album/track01.flac'],
  video: [],
  document: ['Photos/2024/Trip/Day1/notes.txt', 'Docs/report.pdf'],
};

const expectedPaths = (roots, kind) => roots.flatMap((root) => REL[kind].map((rel) => `${root}/${rel}`)).sort();

const rowPaths = async (window) =>
  (await window.evaluate(() => [...document.querySelectorAll('[data-testid="list-row"]')].map((r) => r.dataset.path))).sort();

// Opens a tab and waits until its list shows exactly `paths` (or the empty text when none).
async function openList(window, kind, paths) {
  await window.getByTestId(`view-tab-${kind}`).click();
  if (paths.length === 0) {
    await expect(window.getByTestId('list-empty')).toHaveText(`No ${kind} files in this collection`);
    await expect(window.getByTestId('list-row')).toHaveCount(0);
  } else {
    await expect(window.getByTestId('list-row')).toHaveCount(paths.length);
    await expect(window.getByTestId('list-loading')).toHaveCount(0);
  }
  expect(await rowPaths(window)).toEqual(paths);
}

async function createCollectionUi(app, window, name, roots) {
  await stubFolderPicker(app, roots);
  await window.getByTestId('collection-name').fill(name);
  await window.getByTestId('add-folder').click();
  await expect(window.getByTestId('folder-item')).toHaveCount(roots.length);
  await window.getByTestId('create-collection').click();
  await expect(window.getByTestId('collection-item').filter({ hasText: name })).toHaveCount(1, { timeout: 30000 });
  await expect(window.getByTestId('folder-item')).toHaveCount(0);
}

async function selectCollectionUi(window, name) {
  const item = window.getByTestId('collection-item').filter({ hasText: name });
  await item.click();
  await expect(item).toHaveClass(/collection-selected/, { timeout: 30000 });
  // Attached, not visible: the tree is hidden while a list tab is active.
  await expect(window.getByTestId('tree-row').first()).toBeAttached({ timeout: 30000 });
}

// Expands the collapsed folder rows that are rendered, until none is left.
async function expandRendered(window) {
  const collapsed = window.locator('[data-testid="tree-row"][data-type="folder"][data-expanded="false"]');
  while ((await collapsed.count()) > 0) await collapsed.first().click();
}

const treeFilePaths = async (window) =>
  (await window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tree-row"][data-type="file"]')].map((r) => r.dataset.path),
  )).sort();

// Records every file-selected detail into window.__selected.
const recordSelections = (window) =>
  window.evaluate(() => {
    window.__selected = [];
    document.addEventListener('file-selected', (e) => window.__selected.push(e.detail.file));
  });
const selections = (window) => window.evaluate(() => window.__selected);

async function expectNothingSelected(window) {
  await expect(window.locator('[aria-selected="true"]:not([role="tab"])')).toHaveCount(0);
  await expect(window.getByTestId('file-path')).toHaveClass(/file-path-empty/);
  await expect(window.getByTestId('reveal')).toBeDisabled();
}

test('lists show each kind, load lazily, cache per load, rebuild after each data change, and match the tree', async () => {
  const userDataDir = newUserDataDir('type-wiring-e2e');
  const a = buildFixtureTree();
  const b = buildFixtureTree();
  const c = buildFixtureTree();
  let session;
  try {
    session = await launchApp(userDataDir);
    const { app, window } = session;
    await installTypeListHooks(window);
    await createCollectionUi(app, window, 'Alpha', [a.root]);
    await createCollectionUi(app, window, 'Beta', [c.root]);
    await selectCollectionUi(window, 'Alpha');
    expect(await buildCounts(window)).toEqual({});

    // First open of a tab: the loading state is on screen, with no rows, when the sort starts.
    await setSortDelay(window, 300);
    await openList(window, 'image', expectedPaths([a.root], 'image'));
    await setSortDelay(window, 0);
    const log = await buildLog(window);
    expect(log).toEqual([{ kind: 'image', loadingShown: true, rowsShown: 0 }]);

    // Each tab shows the files of its kind from every folder and none of another kind.
    for (const kind of KINDS) await openList(window, kind, expectedPaths([a.root], kind));
    expect(await buildCounts(window)).toEqual({ image: 1, audio: 1, video: 1, document: 1 });
    await window.getByTestId('view-tab-tree').click();
    await openList(window, 'image', expectedPaths([a.root], 'image'));
    await openList(window, 'audio', expectedPaths([a.root], 'audio'));
    expect(await buildCounts(window)).toEqual({ image: 1, audio: 1, video: 1, document: 1 });

    // The lists hold exactly the files the tree shows.
    await window.getByTestId('view-tab-tree').click();
    await expandRendered(window);
    const fromLists = KINDS.flatMap((kind) => expectedPaths([a.root], kind)).sort();
    expect(await treeFilePaths(window)).toEqual(fromLists);

    // Every data change drops the cache: the open list rebuilds at once, the others on their next open.
    // Starts with the Images tab open and Images and Audio built; `check` runs with the data changed.
    async function afterChange(change, check) {
      const before = await buildCounts(window);
      await change();
      await expect.poll(() => buildCounts(window).then((n) => n.image)).toBe(before.image + 1);
      await check();
      await window.getByTestId('view-tab-audio').click();
      await expect(window.getByTestId('list-loading')).toHaveCount(0);
      await expect.poll(() => buildCounts(window).then((n) => n.audio)).toBe(before.audio + 1);
      await window.getByTestId('view-tab-image').click();
      await expect(window.getByTestId('list-loading')).toHaveCount(0);
      const after = await buildCounts(window);
      expect(after.image).toBe(before.image + 1);
      expect(after.audio).toBe(before.audio + 1);
    }

    // Rescan: a file added on disk shows in Documents.
    await openList(window, 'image', expectedPaths([a.root], 'image'));
    const extra = `${a.root}/Docs/extra.pdf`;
    await afterChange(
      async () => {
        fs.writeFileSync(extra, 'extra\n');
        await window.getByTestId('rescan').click();
        await expect(window.getByTestId('rescan-status')).toHaveText(/^Rescanned/, { timeout: 30000 });
      },
      async () => expect(await rowPaths(window)).toEqual(expectedPaths([a.root], 'image')),
    );
    await openList(window, 'document', [...expectedPaths([a.root], 'document'), extra].sort());
    await openList(window, 'image', expectedPaths([a.root], 'image'));

    // Add folder: the second folder's images join the Images list.
    await stubFolderPicker(app, [b.root]);
    await afterChange(
      async () => {
        await window.getByTestId('add-folder-button').click();
        await expect(window.getByTestId('manage-folder')).toHaveCount(2, { timeout: 30000 });
      },
      async () => expect(await rowPaths(window)).toEqual(expectedPaths([a.root, b.root], 'image')),
    );

    // Remove folder: its images leave the list.
    await afterChange(
      async () => {
        await window.getByTestId('remove-folder').nth(1).click();
        await expect(window.getByTestId('manage-folder')).toHaveCount(1, { timeout: 30000 });
      },
      async () => expect(await rowPaths(window)).toEqual(expectedPaths([a.root], 'image')),
    );

    // Another collection: its files only.
    await afterChange(
      async () => {
        await window.getByTestId('collection-item').filter({ hasText: 'Beta' }).click();
        await expect(window.getByTestId('collection-item').filter({ hasText: 'Beta' })).toHaveClass(/collection-selected/);
      },
      async () => expect(await rowPaths(window)).toEqual(expectedPaths([c.root], 'image')),
    );

  } finally {
    if (session) await session.app.close();
    for (const f of [a, b, c]) cleanupFixtureTree(f.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('switching view clears the selection; the tree keeps its expansion and scroll', async () => {
  const userDataDir = newUserDataDir('type-select-e2e');
  const a = buildFixtureTree();
  const b = buildFixtureTree();
  let session;
  try {
    session = await launchApp(userDataDir);
    const { app, window } = session;
    await createCollectionUi(app, window, 'Pair', [a.root, b.root]);
    await selectCollectionUi(window, 'Pair');
    await recordSelections(window);

    // Tree state to be preserved: expanded folders and scroll position.
    await expandRendered(window);
    const tree = window.getByTestId('tree-view');
    await tree.evaluate((el) => { el.scrollTop = 200; });
    await expect.poll(() => tree.evaluate((el) => el.scrollTop)).toBe(200);
    const treeState = () =>
      window.evaluate(() => ({
        scrollTop: document.querySelector('[data-testid="tree-view"]').scrollTop,
        expanded: [...document.querySelectorAll('[data-testid="tree-row"][data-type="folder"]')]
          .map((r) => `${r.dataset.nodeId}=${r.dataset.expanded}`),
      }));
    // Select a file in the tree, then open Images: nothing is selected and null was announced.
    const treeFile = window.locator('[data-testid="tree-row"][data-type="file"]').first();
    const treeFilePath = await treeFile.getAttribute('data-path');
    await treeFile.click();
    await expect(window.getByTestId('file-path')).toHaveText(treeFilePath);
    const stateBefore = await treeState();
    expect(stateBefore.expanded.length).toBeGreaterThan(0);
    await window.getByTestId('view-tab-image').click();
    await expect(window.getByTestId('list-row').first()).toBeVisible();
    await expectNothingSelected(window);
    expect((await selections(window)).at(-1)).toBeNull();

    // Select in the list, switch to another tab: cleared again.
    const row = window.getByTestId('list-row').first();
    const rowPath = await row.getAttribute('data-path');
    await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(window.getByTestId('file-path')).toHaveText(rowPath);
    await expect(window.getByTestId('reveal')).toBeEnabled();
    const countBefore = (await selections(window)).length;
    await window.getByTestId('view-tab-audio').click();
    await expect(window.getByTestId('list-row').first()).toBeVisible();
    await expectNothingSelected(window);
    const announced = await selections(window);
    expect(announced).toHaveLength(countBefore + 1);
    expect(announced.at(-1)).toBeNull();

    // Back in the list the file is not selected; back in the tree, nothing is selected and the state is unchanged.
    await window.getByTestId('view-tab-image').click();
    await expect(window.getByTestId('list-row').first()).toBeVisible();
    await expect(window.locator('[data-testid="list-row"][aria-selected="true"]')).toHaveCount(0);
    await window.getByTestId('view-tab-tree').click();
    await expect(tree).toBeVisible();
    await expectNothingSelected(window);
    await expect.poll(treeState).toEqual(stateBefore);
  } finally {
    if (session) await session.app.close();
    for (const f of [a, b]) cleanupFixtureTree(f.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a build for a collection that is no longer active is discarded', async () => {
  const userDataDir = newUserDataDir('type-stale-e2e');
  const a = buildFixtureTree();
  const c = buildFixtureTree();
  // Beta also holds a file Alpha does not, so the two image lists differ.
  fs.writeFileSync(path.join(c.root, 'only-beta.png'), 'x\n');
  let session;
  try {
    session = await launchApp(userDataDir);
    const { app, window } = session;
    await installTypeListHooks(window);
    await createCollectionUi(app, window, 'Alpha', [a.root]);
    await createCollectionUi(app, window, 'Beta', [c.root]);
    await selectCollectionUi(window, 'Alpha');
    const betaImages = [...expectedPaths([c.root], 'image'), `${c.root}/only-beta.png`].sort();

    // Via the UI: open Alpha's images, select Beta at once; the rows end up Beta's.
    await window.getByTestId('view-tab-image').click();
    await window.getByTestId('collection-item').filter({ hasText: 'Beta' }).click();
    await expect(window.getByTestId('collection-item').filter({ hasText: 'Beta' })).toHaveClass(/collection-selected/);
    await expect(window.getByTestId('list-row')).toHaveCount(betaImages.length, { timeout: 30000 });
    expect(await rowPaths(window)).toEqual(betaImages);

    // In one task: switch Alpha's list open and replace the data with Beta's before it can build.
    // The pending build for Alpha must be dropped, so the kind is built once, from Beta's data.
    await selectCollectionUi(window, 'Alpha');
    await window.getByTestId('view-tab-tree').click();
    const before = await buildCounts(window);
    const betaId = await window.getByTestId('collection-item').filter({ hasText: 'Beta' }).getAttribute('data-collection-id');
    await window.evaluate(async (id) => {
      const result = await window.mediaOrganizer.getCollectionView(id);
      ViewTabs.select('document');
      TypeViews.show(result.view);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }, betaId);
    const after = await buildCounts(window);
    expect(after.document - (before.document || 0)).toBe(1);
    expect(await rowPaths(window)).toEqual(expectedPaths([c.root], 'document'));
  } finally {
    if (session) await session.app.close();
    for (const f of [a, c]) cleanupFixtureTree(f.root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
