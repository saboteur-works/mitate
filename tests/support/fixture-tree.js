'use strict';
/*
 * Fixture tree builder (FR-17). CommonJS so Vitest, Playwright and the
 * Electron main process can all require it. macOS only (uses `xattr`).
 *
 * API
 *   buildFixtureTree() -> { root, manifest }
 *     Builds the tree in a fresh directory under os.tmpdir() ($TMPDIR).
 *     root:     absolute, realpath-resolved path of the tree's top folder.
 *     manifest: every entry has an absolute `path` and a root-relative `rel`.
 *       files:    [{ path, rel, supported }]   regular files
 *       dirs:     [{ path, rel, kind }]        kind: 'plain' | 'hidden' | 'package'
 *       symlinks: [{ path, rel, target, targetKind }]  targetKind: 'folder' | 'file'
 *       xattrs:   [{ path, rel, name, value }] extended attributes written
 *       maxDepth: depth of the deepest regular file (a file directly in root = 1)
 *       Relative-path lists: supportedFiles, unsupportedFiles, hiddenFiles,
 *       hiddenDirs, packageDirs.
 *     "supported" is the fixture author's intent for the FR-10 registry; it is
 *     not computed from the registry.
 *     Symlink targets are relative and point inside root.
 *   cleanupFixtureTree(root) -> removes the tree; safe to call twice. It only
 *     removes directories whose basename starts with "mo-fixture-".
 *
 *   lockFolder(dir) / unlockFolder(dir) -> chmod 0o000 / 0o755 on a folder that
 *     lies inside a fixture tree (an ancestor's basename starts with
 *     "mo-fixture-"); refuses anything else. Tests must unlock before
 *     cleanupFixtureTree, because rmSync cannot descend into a 000 folder.
 *
 * Contents are small and deterministic. Nothing outside root is touched.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PREFIX = 'mo-fixture-';

function newManifest() {
  return {
    files: [], dirs: [], symlinks: [], xattrs: [], maxDepth: 0,
    supportedFiles: [], unsupportedFiles: [], hiddenFiles: [], hiddenDirs: [], packageDirs: [],
  };
}

function makeOps(root, m) {
  const abs = (r) => path.join(root, r);
  return {
    dir(r, kind = 'plain') {
      fs.mkdirSync(abs(r), { recursive: true });
      m.dirs.push({ path: abs(r), rel: r, kind });
      if (kind === 'hidden') m.hiddenDirs.push(r);
      if (kind === 'package') m.packageDirs.push(r);
    },
    file(r, supported) {
      fs.writeFileSync(abs(r), `fixture:${r}\n`);
      m.files.push({ path: abs(r), rel: r, supported });
      (supported ? m.supportedFiles : m.unsupportedFiles).push(r);
      if (path.basename(r).startsWith('.')) m.hiddenFiles.push(r);
      m.maxDepth = Math.max(m.maxDepth, r.split('/').length);
    },
    xattr(r, name, value) {
      execFileSync('xattr', ['-w', name, value, abs(r)]);
      m.xattrs.push({ path: abs(r), rel: r, name, value });
    },
    link(r, target, targetKind) {
      fs.symlinkSync(target, abs(r));
      m.symlinks.push({ path: abs(r), rel: r, target, targetKind });
    },
  };
}

function populate(o) {
  // Plain nested folders: Photos/2024/Trip/Day1 puts deep.jpg at depth 5.
  o.dir('Photos/2024/Trip/Day1');
  o.dir('Music/Album');
  o.dir('Docs');
  o.file('top.mp3', true);
  o.file('Photos/A.JPG', true); // uppercase extension
  o.file('Photos/2024/b.png', true);
  o.file('Photos/2024/Trip/c.heic', true);
  o.file('Photos/2024/Trip/Day1/deep.jpg', true); // supported, deep
  o.file('Photos/2024/Trip/Day1/notes.txt', true);
  o.file('Music/Album/track01.flac', true);
  o.file('Docs/report.pdf', true);
  o.file('Docs/readme.md', false);
  o.file('Docs/data.xyz', false);

  // Hidden file and hidden folder (name begins with ".").
  o.file('.hidden.jpg', true);
  o.dir('.hiddenDir', 'hidden');
  o.file('.hiddenDir/inside.jpg', true);
  o.file('Photos/.DS_Store', false);

  // Package bundles; their contents must not be indexed.
  o.dir('Thing.app/Contents/Resources', 'package');
  o.file('Thing.app/Contents/Resources/icon.png', true);
  o.file('Thing.app/Contents/Info.plist', false);
  o.dir('Library.photoslibrary/originals', 'package');
  o.file('Library.photoslibrary/originals/IMG_0001.jpg', true);

  // Symlinks, relative targets inside root.
  o.link('link-to-folder', 'Photos/2024', 'folder');
  o.link('link-to-file', 'Photos/A.JPG', 'file');

  // Extended attributes on files (and on a folder).
  o.xattr('Photos/A.JPG', 'com.mediaorganizer.fixture', 'alpha');
  o.xattr('Photos/A.JPG', 'com.mediaorganizer.note', 'second');
  o.xattr('Photos/2024/Trip/Day1/deep.jpg', 'com.mediaorganizer.fixture', 'deep-value');
  o.xattr('Docs/readme.md', 'com.mediaorganizer.fixture', 'unsupported-file');
  o.xattr('Photos/2024', 'com.mediaorganizer.fixture', 'folder-value');
}

function buildFixtureTree() {
  if (process.platform !== 'darwin') {
    throw new Error('fixture-tree requires macOS (uses xattr)');
  }
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX)));
  const manifest = newManifest();
  try {
    populate(makeOps(root, manifest));
  } catch (err) {
    cleanupFixtureTree(root);
    throw err;
  }
  return { root, manifest };
}

function cleanupFixtureTree(root) {
  if (!path.basename(root).startsWith(PREFIX)) {
    throw new Error(`refusing to remove non-fixture directory: ${root}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
}

function assertInsideFixture(dir) {
  const resolved = path.resolve(dir);
  const inside = resolved.split(path.sep).slice(0, -1).some((part) => part.startsWith(PREFIX));
  if (!inside) throw new Error(`refusing to change permissions outside a fixture tree: ${dir}`);
  return resolved;
}

function lockFolder(dir) {
  fs.chmodSync(assertInsideFixture(dir), 0o000);
}

function unlockFolder(dir) {
  fs.chmodSync(assertInsideFixture(dir), 0o755);
}

module.exports = { buildFixtureTree, cleanupFixtureTree, lockFolder, unlockFolder };
