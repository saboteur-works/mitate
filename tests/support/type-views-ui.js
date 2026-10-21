'use strict';

/*
 * Helpers shared by the type-view e2e specs (Feature 4, Tasks 11 to 16): the media files added to
 * the fixture tree, the rows the lists must show for them, a reader for the rows in the DOM, and
 * small UI steps (open a tab, select a collection). Collections are written to the store before
 * launch with the real service and scanner, as the earlier specs do.
 */

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
const TreeModel = require('../../src/shared/tree-model.js');
const { openStorage } = require('../../src/main/storage/index.js');
const { createCollectionService } = require('../../src/main/collections/service.js');

const KINDS = ['image', 'audio', 'video', 'document'];

// Files buildFixtureTree() already holds, by kind, plus the ones addMedia writes. Hidden files,
// package contents, symlinks and the unsupported readme.md and data.xyz are never indexed.
const REL = {
  image: [
    'Photos/A.JPG', 'Photos/2024/b.png', 'Photos/2024/Trip/c.heic', 'Photos/2024/Trip/Day1/deep.jpg',
    'Photos/RAW/shot.cr2', 'Photos/img1.jpg', 'Photos/img2.jpg', 'Photos/img10.jpg',
    'Photos/dup.png', 'Docs/dup.png',
  ],
  audio: ['top.mp3', 'Music/Album/track01.flac', 'Music/song.mp3'],
  video: ['Videos/clip.mp4', 'Videos/Old/clip2.mov'],
  document: ['Photos/2024/Trip/Day1/notes.txt', 'Docs/report.pdf', 'Docs/book.epub', 'Docs/comic.cbz'],
};

const EXTRA = [
  'Photos/RAW/shot.cr2', 'Photos/img1.jpg', 'Photos/img2.jpg', 'Photos/img10.jpg', 'Photos/dup.png', 'Docs/dup.png',
  'Music/song.mp3', 'Videos/clip.mp4', 'Videos/Old/clip2.mov', 'Docs/book.epub', 'Docs/comic.cbz',
];

// Adds the extra supported files (RAW, natural-order names, a same-name pair, video, epub, cbz).
function addMedia(root) {
  for (const rel of EXTRA) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `extra:${rel}\n`);
  }
}

const byNameThenPath = (a, b) =>
  TreeModel.compareNames(a.name, b.name) || (a.path === b.path ? 0 : a.path < b.path ? -1 : 1);

// The rows a list must show for `rels` under `root`: name, absolute path, folder label.
function expectedRows(root, rels) {
  return rels
    .map((rel) => {
      const parts = rel.split('/');
      return {
        name: parts[parts.length - 1],
        path: `${root}/${rel}`,
        folder: parts.length > 1 ? parts.slice(0, -1).join('/') : path.basename(root),
      };
    })
    .sort(byNameThenPath);
}

// The list-row elements now in the DOM in index order: { index, path, name, folder, unavailable }.
const listRows = (window) =>
  window.evaluate(() =>
    [...document.querySelectorAll('[data-testid="list-row"]')]
      .map((r) => ({
        index: Number(r.dataset.index),
        path: r.dataset.path,
        name: r.querySelector('[data-testid="list-row-name"]').textContent,
        folder: r.querySelector('[data-testid="list-row-folder"]').textContent,
        unavailable: r.querySelector('[data-testid="unavailable"]') !== null,
      }))
      .sort((a, b) => a.index - b.index),
  );

// Opens a tab and waits for its list: `count` rows, or the empty text when count is 0.
async function openList(window, kind, count) {
  await window.getByTestId(`view-tab-${kind}`).click();
  if (count === 0) {
    await expect(window.getByTestId('list-empty')).toHaveText(`No ${kind} files in this collection`);
    await expect(window.getByTestId('list-row')).toHaveCount(0);
  } else {
    await expect(window.getByTestId('list-row')).toHaveCount(count);
    await expect(window.getByTestId('list-loading')).toHaveCount(0);
  }
}

// Writes a collection to <userDataDir>/store.json with the real service and scanner.
async function seedCollection(userDataDir, name, folderPaths) {
  const storage = openStorage({ location: { baseDir: userDataDir } });
  return createCollectionService({ storage }).createCollection(name, folderPaths);
}

// Clicks the named collection and waits for its tree rows (attached: a list tab may be active).
async function selectCollection(window, name) {
  const item = window.getByTestId('collection-item').filter({ hasText: name });
  await item.click();
  await expect(item).toHaveClass(/collection-selected/, { timeout: 30000 });
  await expect(window.getByTestId('tree-row').first()).toBeAttached({ timeout: 30000 });
}

async function expectNothingSelected(window) {
  await expect(window.locator('[aria-selected="true"]:not([role="tab"])')).toHaveCount(0);
  await expect(window.getByTestId('file-path')).toHaveClass(/file-path-empty/);
  await expect(window.getByTestId('reveal')).toBeDisabled();
}

module.exports = {
  KINDS, REL, addMedia, expectedRows, listRows, openList, seedCollection, selectCollection, expectNothingSelected,
};
