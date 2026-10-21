# Mitate

A read-only desktop lens over folders you already have. You group folders into named collections, and the app indexes every supported media file inside them, however deeply nested, and shows the folder tree. It never moves, renames, edits or deletes a file. See [docs/concept.md](docs/concept.md) for the full concept.

Current state: Feature 1, "index a folder collection and browse its tree" ([spec](specs/features/collection-index-tree.md)), Feature 2, "File location and Reveal in Finder" ([spec](specs/features/location-reveal.md)), and Feature 3, "Manage and switch between collections" ([spec](specs/features/collection-management.md)). It is an Electron app (Electron 44, macOS first) with:

- create a collection from folders chosen in a directory-only picker
- folder discovery of supported media files, run in a worker thread
- a virtualized folder tree view
- per-collection rescan
- collections and their index persisted as JSON in the app's own user-data directory
- select a file in the tree by click or keyboard; its full absolute path is shown below the tree
- a "Reveal in Finder" button for the selected file, with error messages for a missing file and for a file that cannot be checked (see [Reveal in Finder](#reveal-in-finder)); the hands-on check of the real reveal was run on 2026-10-20 (internal drive and an external USB thumb drive passed per the user's report; network volume not run), see [the record](docs/measurements/reveal-in-finder.md)
- a management panel for the selected collection: rename, folder list with Remove folder, Add folder, and Delete collection (see [Collection management](#collection-management))
- overlap rules, in the main process: adding a folder that is inside or identical to a folder of the collection is refused, adding a folder that contains existing ones asks once and replaces them, and creating a collection drops picks nested inside other picks and tells you which
- a file reachable through nested or identical folders of one collection appears once in the tree (a safety net for collections stored before these rules, with no migration)
- the same folder can be in several collections, each with its own folder record and index
- while a collection's scan runs, its management controls are disabled and the main process refuses them

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

If the data file (`store.json`) cannot be opened at startup, `src/main/startup.js` shows an error dialog titled "Cannot open data file", and `main.js` then quits the app. The message names the file and states what went wrong, with separate wording for: a format version newer than the one this version reads, an older format version, a file with no recognizable format version, invalid JSON, permission denied (`EACCES`/`EPERM`), and any other open error. Each message states that the file has not been changed; opening only reads it. The folder picker and other dialogs attach to the app's main window (`getWindow` in `src/main/main.js`), whether or not that window has focus.

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

The tests launch the app through `tests/support/background-main.js` (the path is exported as `APP_ENTRY` by `tests/support/app-entry.js`), which loads the real app with hidden windows and, on macOS, without a Dock icon, so a test run doesn't take over the screen or steal focus. To watch the windows while debugging a test, run `MO_E2E_VISIBLE=1 npm run test:e2e`.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/main/` | Electron main process: `main.js`, `startup.js`, `preload.js`, `ipc.js`, and the `collections/`, `discovery/`, `registry/` and `storage/` modules |
| `src/renderer/` | Renderer: `index.html`, `styles.css`, create-collection UI, tree view, rescan button, collection management panel |
| `src/shared/` | Code shared by main and renderer (`tree-model.js`) |
| `tools/readonly-check/` | Reusable read-only check (see below) |
| `tools/atime-measurement/` | Script that records whether a plain `cat` read changes a file's access time |
| `tools/store-scale/` | Script that measures the JSON store at 50,000, 200,000 and 500,000 file records (see below) |
| `tools/scan-speed/` | Scripts that measure scan wall time and peak RSS (see below) |
| `tools/format-probe/` | Format-support probes behind [docs/research/format-support.md](docs/research/format-support.md) |
| `tests/unit/`, `tests/e2e/` | Vitest and Playwright tests |
| `tests/support/` | Test helpers, including the fixture-tree builder (`fixture-tree.js`), the background Electron entry (`background-main.js`, `app-entry.js`), the e2e app launcher and helpers (`e2e-app.js`), the IPC handler wrapper used by e2e tests (`ipc-wrap.js`), `counting-fs.js`, `scan-hold.js` (holds one scan worker's events in the main process for busy-state tests) and the `dialog.showMessageBox` stub in `background-main.js` (see [Collection management](#collection-management)) |
| `docs/` | Concept, research and measurement records |
| `specs/` | Product and feature specs |

## Reveal in Finder

Select a file in the tree (click, or keyboard: the tree is one Tab stop, Up/Down move focus, Enter or Space selects a file or toggles a folder). One file is selected at a time. The detail area below the tree shows the file's full absolute path, wrapped and selectable, or an empty state when nothing is selected. The "Reveal in Finder" button is disabled until a file is selected.

The action only reveals; it does not modify files. It reveals only a path that is in the index (otherwise the error code is `NOT_INDEXED`). Before revealing, it checks that the file exists with `lstat`; no file contents are read. A missing file shows "File not found: <path>" (`FILE_NOT_FOUND`); a check refused with `EACCES` or `EPERM` shows "Can't check this file: permission denied (<code>): <path>" (`FILE_UNCHECKABLE`). An error clears when the selection changes or the tree refreshes. An e2e read-only check around selecting and revealing (`tests/e2e/reveal-readonly.spec.js`) reported no differences, including 0 access-time differences in that run.

The e2e tests do not call the real reveal. `tests/support/background-main.js` gives the app a `shell` whose `showItemInFolder` records the path into `globalThis.__moReveals` and never calls the real one, also when `MO_E2E_VISIBLE=1`. Tests read the recorded calls with `revealCalls(app)` and clear them with `resetRevealCalls(app)`, both from `tests/support/e2e-app.js`. The real channel checks still run.

The hands-on check of the real reveal on macOS was run on 2026-10-20 on the internal drive and on an external USB thumb drive; both passed per the user's report. The network volume was not run. The record is in [docs/measurements/reveal-in-finder.md](docs/measurements/reveal-in-finder.md).

## Collection management

Select a collection to open its management panel. No collection is active at launch, and the active collection is not remembered between launches.

- **Rename**: the name is trimmed and an empty name is refused. Duplicate names are allowed.
- **Folders**: the panel lists the collection's folders, each with a Remove folder button. Removing the last folder is refused with a message suggesting deleting the collection instead.
- **Add folder**: opens a directory-only picker; each picked folder is added in order, and only the new folder is scanned.
- **Delete collection**: always asks for confirmation, and the message says no files on disk are touched. Deleting the active collection leaves no collection active and clears the tree.

The overlap rules run in the main process. Paths are compared after resolving symlinks, case-insensitively, by whole folder names.

- **Inside or identical**: adding a folder that is inside a folder of the collection, or the same folder, is refused with a message naming the covering folder. There is no dialog and nothing is written or scanned.
- **Containing**: adding a folder that contains folders already in the collection asks for confirmation ("Replace folders"). On confirm the new folder is scanned and replaces the contained folders in one step (their records, index entries and access data are removed), and a notice names the replaced folders. Cancelling writes nothing. Files on disk are never touched.
- **Creation**: picks that lie inside another pick (or repeat one) are dropped, with no dialog, and a notice names each dropped folder and the folder that covers it.

Collections stored before these rules may still hold nested or identical folders. A file reachable through them appears once, under the outer (containing) folder, and every folder is still shown; nothing is migrated or rewritten.

The same folder may be in several collections. Each collection keeps its own folder record and index, so a shared folder is scanned and stored once per collection. The store format is unchanged (version 1); a version-1 store written before this feature opens unchanged, tested with a fixture generated by pre-feature code in `tests/fixtures/v1-store`.

While a collection's rescan or add-folder scan runs, its rename, add, remove and delete controls are disabled and the main process refuses them with the error code `COLLECTION_BUSY`.

Test helpers: `tests/support/background-main.js` replaces `dialog.showMessageBox` so no real dialog is shown. `stubConfirm(app, [bool...])` (from `tests/support/e2e-app.js`) sets the answers in order (true confirms); the default answer is Cancel. `confirmCalls(app)` returns the recorded calls. `tests/support/scan-hold.js` exports `holdNextScan(app)`, which holds the next scan worker's events in the main process until released, so a test can act while a scan is in flight. An e2e read-only check around every management flow (`tests/e2e/management-readonly.spec.js`) reported no differences, including 0 access-time differences in those runs.

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

## Store scale measurement

```sh
node tools/store-scale/measure.js [--sizes 50000,200000,500000] [--runs 5]
```

Runs under plain Node and writes [docs/measurements/json-store-scale.md](docs/measurements/json-store-scale.md), which records the numbers and the method.

## Scan speed measurement

```sh
node tools/scan-speed/measure.js [--runs 5] [--files 200000] [--skip-system] [--system-path /System/Library]
node tools/scan-speed/generate-tree.js <absolute-dir> [count]
```

`measure.js` runs under plain Node and writes [docs/measurements/scan-speed.md](docs/measurements/scan-speed.md), which records the numbers and the method. `generate-tree.js` builds a synthetic folder tree of `count` files (default 200000) in `<absolute-dir>`; `measure.js` uses it as a module.
