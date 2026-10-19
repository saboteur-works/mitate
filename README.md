# Media Organizer (working title)

A read-only desktop lens over folders you already have. You group folders into named collections, and the app indexes every supported media file inside them, however deeply nested, and shows the folder tree. It never moves, renames, edits or deletes a file. See [docs/concept.md](docs/concept.md) for the full concept.

Current state: Feature 1, "index a folder collection and browse its tree" ([spec](specs/features/collection-index-tree.md)). It is an Electron app (Electron 44, macOS first) with:

- create a collection from folders chosen in a directory-only picker
- folder discovery of supported media files, run in a worker thread
- a virtualized folder tree view
- per-collection rescan
- collections and their index persisted as JSON in the app's own user-data directory

## Install

```sh
npm install
```

`npm install` downloads the Electron binary as part of installing the `electron` package. If that download fails, the `electron_config_cache` environment variable (read by the Electron installer's download step) points it at a cache directory, so a previously downloaded Electron zip placed there can be used instead of downloading again.

If the download fails, place the zip for the version in `package.json` in the cache directory yourself, flat (no subdirectory), then run the installer against that cache. These steps worked on macOS arm64 with Electron 44.9.0; the version in the file name and URL must match the installed `electron` version:

```sh
curl -fL -o ~/Library/Caches/electron/electron-v44.9.0-darwin-arm64.zip \
  https://github.com/electron/electron/releases/download/v44.9.0/electron-v44.9.0-darwin-arm64.zip
electron_config_cache=$HOME/Library/Caches/electron node node_modules/electron/install.js
```

The installer exited 0 and `node_modules/electron/dist/version` read `44.9.0`.

## Run

```sh
npm start
```

`npm start` launches Electron. Collection data is stored under Electron's `app.getPath('userData')` (`src/main/main.js` passes it to the storage module).

## Build

```sh
npm run build
```

The `build` script runs `node --check` on the main-process, renderer and shared source files (a syntax check). It does not package the app.

## Test

```sh
npm test            # Vitest unit tests (tests/unit/**/*.test.js)
npm run test:e2e    # Playwright end-to-end tests (tests/e2e/*.spec.js)
```

The end-to-end tests launch the Electron app, so they need to be able to start Electron. A restricted sandbox may block that, in which case run `npm run test:e2e` from an unrestricted terminal. The Playwright config runs with one worker.

The tests launch the app through `tests/support/background-main.js`, which loads the real app with hidden windows and, on macOS, without a Dock icon, so a test run doesn't take over the screen or steal focus. To watch the windows while debugging a test, run `MO_E2E_VISIBLE=1 npm run test:e2e`.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/main/` | Electron main process: `main.js`, `preload.js`, `ipc.js`, and the `collections/`, `discovery/`, `registry/` and `storage/` modules |
| `src/renderer/` | Renderer: `index.html`, `styles.css`, create-collection UI, tree view, rescan button |
| `src/shared/` | Code shared by main and renderer (`tree-model.js`) |
| `tools/readonly-check/` | Reusable read-only check (see below) |
| `tools/atime-measurement/` | Script that records whether a plain `cat` read changes a file's access time |
| `tools/format-probe/` | Format-support probes behind [docs/research/format-support.md](docs/research/format-support.md) |
| `tests/unit/`, `tests/e2e/` | Vitest and Playwright tests |
| `tests/support/` | Test helpers, including the fixture-tree builder (`fixture-tree.js`) |
| `docs/` | Concept, research and measurement records |
| `specs/` | Product and feature specs |

## Read-only check

`tools/readonly-check/` is meant to be reused by every feature's tests. It snapshots a directory tree and compares two snapshots, so a test can show that running the app left the files unchanged.

```js
const { snapshot, assert } = require('../../tools/readonly-check');

const before = snapshot(dir, { role: 'before' });
// ...run the app flow...
const after = snapshot(dir, { role: 'after' });
assert(before, after);                         // throws on any non-atime difference
assert(before, after, { failOnAtime: true });  // access-time differences also throw
```

Each snapshot entry records relative path, entry type, size, mode, content hash (files), modification, change, birth and access times, and extended attributes. Entries are read with `lstat`, so symlinks are recorded and not followed. Access-time differences are always reported in the result's `atime` list and fail the check only when `failOnAtime` is true. The `role` option orders the access-time read relative to content hashing (see the header comments in `tools/readonly-check/index.js` and `snapshot.js`). `tests/e2e/full-flow.spec.js` uses it around a full create-and-browse flow, and `tests/unit/readonly-check.test.js` tests the check itself.

## Access-time measurement

```sh
node tools/atime-measurement/measure.js <volume-path> --label <internal-apfs|external|network>
```

Results are recorded in [docs/measurements/atime-cat-read.md](docs/measurements/atime-cat-read.md). So far one volume has been measured: one run on internal APFS, where the access time differed after a `cat` read. External and network volumes are recorded as not measured. That record does not say what happens on other volumes or other filesystems.
