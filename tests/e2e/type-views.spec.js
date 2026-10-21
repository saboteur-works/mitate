'use strict';

/*
 * Type view lists e2e (Feature 4, Task 11; FR-1, FR-4, FR-8, FR-13). Collections are written to
 * <userDataDir>/store.json before launch with the real service and scanner; the lists are read
 * through the UI. What type-views-wiring.spec.js already covers (lazy build, cache, rebuild after
 * data changes, match with the tree, stale builds) is not repeated here. This spec adds the row
 * content, folder labels, order and ties, the empty text, the unavailable label, unsupported files
 * and Rescan from a list view.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp, selectOnlyCollection } = require('../support/e2e-app.js');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const {
  KINDS, REL, addMedia, expectedRows, listRows, openList, seedCollection, selectCollection,
} = require('../support/type-views-ui.js');

test('each list shows every file of its kind with name and folder, in natural order, and nothing else', async () => {
  const userDataDir = newUserDataDir('type-lists-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  let session;
  try {
    addMedia(root);
    await seedCollection(userDataDir, 'Media', [root]);
    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);

    const seen = new Set();
    for (const kind of KINDS) {
      const expected = expectedRows(root, REL[kind]);
      await openList(window, kind, expected.length);
      const rows = await listRows(window);
      // Names, absolute paths and folder labels, in order, equal to what the fixture holds.
      expect(rows.map(({ name, path: p, folder }) => ({ name, path: p, folder }))).toEqual(expected);
      expect(rows.some((r) => r.unavailable)).toBe(false);
      for (const r of rows) seen.add(r.path);
    }
    expect(seen.size).toBe(KINDS.reduce((n, k) => n + REL[k].length, 0));

    // Images: RAW and uppercase extension are listed; Documents: pdf, txt, epub and cbz.
    await openList(window, 'image', REL.image.length);
    const images = (await listRows(window)).map((r) => r.name);
    expect(images).toContain('shot.cr2');
    expect(images).toContain('A.JPG');
    await openList(window, 'document', REL.document.length);
    const documents = (await listRows(window)).map((r) => r.name).sort();
    expect(documents).toEqual(['book.epub', 'comic.cbz', 'notes.txt', 'report.pdf']);

    // Unsupported files are in no list.
    for (const kind of KINDS) {
      await openList(window, kind, REL[kind].length);
      const names = (await listRows(window)).map((r) => r.name);
      expect(names).not.toContain('readme.md');
      expect(names).not.toContain('data.xyz');
    }

    // Folder part: a top-level file shows the root folder's name, a nested one its relative path.
    await openList(window, 'audio', REL.audio.length);
    const audio = await listRows(window);
    expect(audio.find((r) => r.name === 'top.mp3').folder).toBe(path.basename(root));
    expect(audio.find((r) => r.name === 'track01.flac').folder).toBe('Music/Album');
    await openList(window, 'video', REL.video.length);
    expect((await listRows(window)).map((r) => r.folder)).toEqual(['Videos', 'Videos/Old']);

    // Order: natural, so img2 comes before img10.
    await openList(window, 'image', REL.image.length);
    const names = (await listRows(window)).map((r) => r.name);
    expect(names.indexOf('img1.jpg')).toBeLessThan(names.indexOf('img2.jpg'));
    expect(names.indexOf('img2.jpg')).toBeLessThan(names.indexOf('img10.jpg'));

    // Ties: two files named dup.png both appear, ordered by absolute path, with different folders.
    const dups = (await listRows(window)).filter((r) => r.name === 'dup.png');
    expect(dups.map((r) => r.path)).toEqual([`${root}/Docs/dup.png`, `${root}/Photos/dup.png`]);
    expect(dups.map((r) => r.folder)).toEqual(['Docs', 'Photos']);
    expect(dups[1].index).toBe(dups[0].index + 1);

    // No skipped count in the views (the Rescan status line is Feature 1's and is not part of them).
    await expect(window.getByTestId('view-tabs')).not.toContainText(/skipped/i);
    await expect(window.getByTestId('view-area')).not.toContainText(/skipped/i);

    // Rescan works from the Images view, and the list shows a file added on disk before it.
    const added = `${root}/Photos/img3.jpg`;
    fs.writeFileSync(added, 'added after launch\n');
    await expect(window.getByTestId('list-row')).toHaveCount(REL.image.length);
    await window.getByTestId('rescan').click();
    await expect(window.getByTestId('rescan-status')).toHaveText(/^Rescanned/, { timeout: 30000 });
    await expect(window.getByTestId('list-row')).toHaveCount(REL.image.length + 1);
    const rescanned = await listRows(window);
    expect(rescanned.map((r) => r.path)).toContain(added);
    const rescannedNames = rescanned.map((r) => r.name);
    expect(rescannedNames.indexOf('img2.jpg') + 1).toBe(rescannedNames.indexOf('img3.jpg'));
    expect(rescannedNames.indexOf('img3.jpg')).toBeLessThan(rescannedNames.indexOf('img10.jpg'));
    await expect(window.getByTestId('view-tab-image')).toHaveAttribute('aria-selected', 'true');
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('a collection with no file of a kind shows the empty text for it and no rows', async () => {
  const userDataDir = newUserDataDir('type-empty-e2e');
  const fixture = buildFixtureTree();
  const root = fixture.root;
  const onlyUnsupported = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-type-empty-'));
  const onlyImage = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-type-image-'));
  let session;
  try {
    // The fixture tree as it is holds no video file.
    fs.writeFileSync(path.join(onlyUnsupported, 'notes.md'), 'unsupported\n');
    fs.writeFileSync(path.join(onlyUnsupported, 'data.xyz'), 'unsupported\n');
    fs.writeFileSync(path.join(onlyImage, 'one.png'), 'x\n');
    await seedCollection(userDataDir, 'Plain', [root]);
    await seedCollection(userDataDir, 'Unsupported', [onlyUnsupported]);
    await seedCollection(userDataDir, 'Image', [onlyImage]);
    session = await launchApp(userDataDir);
    const { window } = session;
    await expect(window.getByTestId('collection-item')).toHaveCount(3, { timeout: 30000 });

    await selectCollection(window, 'Plain');
    await openList(window, 'video', 0);
    await expect(window.getByTestId('list-empty')).toHaveText('No video files in this collection');
    await openList(window, 'image', 4);

    // A collection whose only files are unsupported: all four lists are empty.
    await selectCollection(window, 'Unsupported');
    for (const kind of KINDS) {
      await openList(window, kind, 0);
      await expect(window.getByTestId('list-empty')).toHaveText(`No ${kind} files in this collection`);
    }

    // A collection with one image: the other three are empty, Images has the one row.
    await selectCollection(window, 'Image');
    for (const kind of ['audio', 'video', 'document']) await openList(window, kind, 0);
    await openList(window, 'image', 1);
    await expect(window.getByTestId('list-empty')).toHaveCount(0);
    expect((await listRows(window)).map((r) => r.path)).toEqual([`${onlyImage}/one.png`]);
  } finally {
    if (session) await session.app.close();
    cleanupFixtureTree(root);
    for (const dir of [onlyUnsupported, onlyImage]) fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('files of a folder that is no longer on disk are listed with the unavailable label', async () => {
  const userDataDir = newUserDataDir('type-unavailable-e2e');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-type-unavail-'));
  const gone = path.join(base, 'gone');
  const here = path.join(base, 'here');
  let session;
  try {
    fs.mkdirSync(path.join(gone, 'sub'), { recursive: true });
    fs.mkdirSync(here);
    fs.writeFileSync(path.join(gone, 'a.jpg'), 'a\n');
    fs.writeFileSync(path.join(gone, 'sub', 'b.png'), 'b\n');
    fs.writeFileSync(path.join(gone, 'song.mp3'), 's\n');
    fs.writeFileSync(path.join(here, 'c.jpg'), 'c\n');
    await seedCollection(userDataDir, 'Mixed', [gone, here]);
    fs.rmSync(gone, { recursive: true, force: true });

    session = await launchApp(userDataDir);
    const { window } = session;
    await selectOnlyCollection(window);

    await openList(window, 'image', 3);
    const rows = await listRows(window);
    expect(rows.map((r) => [r.path, r.unavailable])).toEqual([
      [`${gone}/a.jpg`, true],
      [`${gone}/sub/b.png`, true],
      [`${here}/c.jpg`, false],
    ]);
    // Scoped to the list: the hidden tree panel labels the unavailable root row too.
    const listLabels = window.getByTestId('list-view').getByTestId('unavailable');
    await expect(listLabels).toHaveCount(2);
    await expect(listLabels.first()).toHaveText('unavailable');
    expect(rows.map((r) => r.folder)).toEqual(['gone', 'sub', 'here']);

    await openList(window, 'audio', 1);
    expect((await listRows(window))[0]).toMatchObject({ path: `${gone}/song.mp3`, unavailable: true });
    await expect(window.getByTestId('list-view').getByTestId('unavailable')).toHaveText('unavailable');
  } finally {
    if (session) await session.app.close();
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
