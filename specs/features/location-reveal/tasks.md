# Tasks: File location and Reveal in Finder

**Spec:** `specs/features/location-reveal.md`
**Branch:** `feat/location-reveal`
**Estimation unit:** story points (1/2/3/5/8)

Conventions: every task names the FRs it covers in its Notes. Test commands use the existing npm scripts (`npm test` runs Vitest; `npm run test:e2e` runs Playwright; `npm run build` runs `node --check` over the listed files, so every new source file under `src/` must be added to the `build` script in `package.json` in the task that creates it). E2E tests run through `tests/support/background-main.js` and never perform a real reveal.

Design decisions made by this breakdown (they follow from the spec and the shipped code, not from new product choices):
- The renderer sends the file's absolute path on a new channel `files:reveal` (`CHANNELS.revealFile`); the main process reveals it only if a stored file record has exactly that path (FR-6). Overlapping roots can store the same path twice; both records describe the same file on disk, so either match is valid.
- The reveal is one thin function, `revealFile(path)` in `src/main/reveal.js`, built by `createRevealer({ shell, exists })`. It is injected into `registerIpc` (parameter `revealFile`), so unit tests pass a fake. `shell.showItemInFolder(fullPath)` is declared `void` in the installed Electron 44.9.0 typings (`node_modules/electron/electron.d.ts`: "Show the given file in a file manager. If possible, select the file."), so it gives no failure signal; the not-found check (FR-9) is therefore an explicit existence check before the call.
- E2E stub: `tests/support/background-main.js` already hands the app a proxied `electron` module. It will also hand it a `shell` whose `showItemInFolder` records the path in `globalThis.__moReveals` and never calls the real function. This keeps the real handler (`guard`, index check, existence check) under test while guaranteeing no e2e run through background-main can reveal anything. `tests/support/ipc-wrap.js` is not used for the reveal because wrapping the channel handler would bypass the code under test.
- Renderer wiring: `tree-view.js` owns selection and focus and announces the selected file with a `file-selected` event on `document` (`event.detail.file` is `{ nodeId, path, name, unavailable }` or `null`), the same pattern as the existing `collection-selected` event. A new `src/renderer/file-detail.js` listens to it and drives the path display and the Reveal button.

### Task 1: Reveal function with explicit existence check
**What:** Add `src/main/reveal.js` exporting `createRevealer({ shell, exists })`, which returns `revealFile(path)`: it throws an error with code `FILE_NOT_FOUND` and a message naming the path when the file does not exist, and otherwise calls `shell.showItemInFolder(path)`.
**Files:** src/main/reveal.js, tests/unit/reveal.test.js, package.json (add `node --check src/main/reveal.js` to `build`)
**Done when:** `npx vitest run tests/unit/reveal.test.js && npm run build` exits 0, with tests asserting: an existing path calls the fake `shell.showItemInFolder` exactly once with that exact path; a missing path (fake `exists` returns false) throws an error whose `code` is `FILE_NOT_FOUND` and whose message contains the path, and `showItemInFolder` is not called; `showItemInFolder` is never called with any path other than the requested one (no parent-folder fallback); the default `exists` uses `fs.promises.lstat` (existence only, no read of file contents) and returns true for a real temp file and false after it is deleted.
**Depends on:** none
**Estimate:** 2
**Notes:** Covers FR-7, FR-8, FR-9, FR-10 (main-side behaviour), FR-13 (existence check reads metadata only) and the not-found part of FR-16 (file-system check replaced by the injected `exists`). Electron's `shell.showItemInFolder` returns void (verified against `electron.d.ts` in this repo), which is why the check is explicit. The macOS-only call lives only here; nothing in FR-1 to FR-5 imports this module.
**POS:** task_0f0951db
**Done:** [x]

### Task 2: Look up a stored file record by path
**What:** Add `findIndexedFile(filePath)` to the collection service, returning the stored file record whose `path` equals `filePath` exactly, or `null`.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js` exits 0, with new tests asserting: a path of an indexed file returns its record; a path that is not in the index returns `null`; a path of a folder (a root or a subfolder) returns `null`; a path that differs only by a trailing segment or by case returns `null`; a file in an unavailable folder is still found; the lookup does not change the stored index (storage contents identical before and after) and does not touch the file system.
**Depends on:** none
**Estimate:** 2
**Notes:** Covers FR-6 (the index membership half), FR-10 (unavailable files are still found). Implementation hint: `storage.getIndex()` with no filter returns every stored record (`src/main/storage/index.js`); compare `record.path === filePath`. Do not use `path.resolve` or normalization on the input: the check is for exact stored paths, so a path that only resolves to an indexed file is rejected.
**POS:** task_e9e4f649
**Done:** [x]

### Task 3: `files:reveal` channel, preload method and main wiring
**What:** Add the `revealFile` channel to `CHANNELS` and `registerIpc` (through `guard`, rejecting any path not in the index), mirror it in `window.mediaOrganizer`, and wire the real revealer in `main.js`.
**Files:** src/main/ipc.js, src/main/preload.js, src/main/main.js, tests/unit/ipc.test.js
**Done when:** `npx vitest run tests/unit/ipc.test.js && npm run build` exits 0, with tests asserting: `CHANNELS.revealFile` is `'files:reveal'` and the handler is registered; an indexed path calls the injected `revealFile` once with that exact path and returns `{ ok: true }`; a path not returned by `service.findIndexedFile` returns `{ ok: false, error, code: 'NOT_INDEXED' }` and `revealFile` is not called (this is the FR-16 "path not in the index" test); a non-string or empty argument is rejected the same way; an error thrown by `revealFile` with `code: 'FILE_NOT_FOUND'` comes back as `{ ok: false, error, code: 'FILE_NOT_FOUND' }` with the message naming the path; with no `revealFile` injected the handler returns `{ ok: false, error }`; and a text check that `src/main/preload.js` exposes `revealFile` invoking the literal `'files:reveal'`. `main.js` passes `revealFile: createRevealer({ shell, exists }).revealFile` (using `shell` from `electron`) to `registerIpc`.
**Depends on:** 1, 2
**Estimate:** 3
**Notes:** Covers FR-6 (main-process rejection), FR-8 (one channel, mirrored in preload, `{ ok }` through `guard`, replaceable function), FR-9, FR-10, FR-16 (rejection of a path not in the index). Update the header comment in `ipc.js` that lists the channels. A sandboxed preload cannot require local modules, so the channel name is duplicated as a literal there, as for the other five channels. The index check runs before the existence check so an unindexed path never reaches the file system.
**POS:** task_bf7f836e
**Done:** [x]

### Task 4: E2E stub of the shell reveal and a channel smoke test
**What:** Make `tests/support/background-main.js` give the app a `shell` whose `showItemInFolder` records its argument and does nothing else, add helpers to read the recorded calls, and prove the stub and the channel with one e2e that calls `window.mediaOrganizer.revealFile` directly.
**Files:** tests/support/background-main.js, tests/support/e2e-app.js, tests/e2e/reveal-channel.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/reveal-channel.spec.js` exits 0, with a test that builds a collection from the fixture tree before launch, launches through `launchApp`, and asserts: `revealCalls(app)` is `[]` after launch; `window.evaluate(p => window.mediaOrganizer.revealFile(p), <indexed fixture file path>)` resolves `{ ok: true }` and `revealCalls(app)` equals `[<that path>]`; the same call with a path that exists on disk but is not indexed resolves `{ ok: false, code: 'NOT_INDEXED' }` and adds no recorded call; no Finder or other window comes to the front (the test runs hidden; the run is made without `MO_E2E_VISIBLE`).
**Depends on:** 3
**Estimate:** 3
**Notes:** Covers FR-14 (the replacement of the reveal function and recording of its path, in the shared support code) and the main-process half of FR-6. `app.evaluate` receives the real `electron` module, not the proxied one, so the stub must be installed in the proxy inside `background-main.js` (extend the `get` trap with `key === 'shell'`), and the recorded array is read through `globalThis.__moReveals`. The stub must not call the real `shell.showItemInFolder` under any condition, including `MO_E2E_VISIBLE=1`. Export a helper such as `revealCalls(app)` from `e2e-app.js`; keep the stub self-contained in `background-main.js` and document it in that file's header comment.
**POS:** task_0b32d4e0
**Done:** [x]

### Task 5: Pure file-detail model with unit tests
**What:** Add a DOM-free module that maps a selected file (or none) to what the detail area shows: the path text, the empty-state text, and whether Reveal is disabled.
**Files:** src/shared/file-detail.js, tests/unit/file-detail.test.js, package.json (add `node --check src/shared/file-detail.js` to `build`)
**Done when:** `npx vitest run tests/unit/file-detail.test.js && npm run build` exits 0, with tests asserting: for a short path (`/Volumes/Media/a.jpg`) `pathText` equals the stored path exactly; for a path over 300 characters `pathText` equals the full stored path (same length, same string, no ellipsis, no inserted characters); with `null` selection `pathText` is the empty string, an empty-state text is present and `revealDisabled` is `true`; with a selected file `revealDisabled` is `false`; a file with `unavailable: true` still returns its path and `revealDisabled: false`; an entry whose `type` is a folder (defensive) behaves as no selection.
**Depends on:** none
**Estimate:** 2
**Notes:** Covers FR-3, FR-4 (full text present), FR-5, FR-11 (folders never give a path or an enabled button) and the path-display and disabled-state parts of FR-16. The module follows the dual-use pattern of `src/shared/tree-model.js` (loaded as a global in the renderer, `require`d by Vitest); read that file's export block and copy it. The wrapping and selectability (visual half of FR-4) are CSS and are checked in Task 9.
**POS:** task_ce47f155
**Done:** [x]

### Task 6: Select a file by clicking its row
**What:** Add selection state to `tree-view.js`: clicking a file row selects it, the selected row shows a selected state, exactly one file is selected, and a `file-selected` event announces the selection.
**Files:** src/renderer/tree-view.js, src/renderer/styles.css, tests/e2e/file-selection.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/file-selection.spec.js && npm run build` exits 0, with a test on the fixture tree asserting: clicking a file row sets `aria-selected="true"` and a `tree-selected` class on that row only; clicking a second file moves the selected state to it and exactly one row has `aria-selected="true"`; a `file-selected` event on `document` carries `detail.file.path` equal to the row's `data-path` and `detail.file.nodeId` equal to its `data-node-id`; clicking a file does not change the number or order of visible rows and does not change any folder's `aria-expanded`; clicking a folder row still expands or collapses it and does not alter which file is selected; the selected row remains selected after scrolling it out of and back into the virtual window (state keyed by node id, not by DOM element); with two overlapping roots that show the same path, only the clicked row is selected.
**Depends on:** none
**Estimate:** 3
**Notes:** Covers FR-1, FR-11 (folder rows keep their behaviour, a folder click never selects a file). Selection is keyed by `node.id` (`<rootFolderId>:<relativePath>`), never by `data-path`. `makeRow` must set `aria-selected` from the stored selected id so virtualized re-renders keep the state. The overlapping-roots case can be built from a collection with a root and its own subfolder as two roots (the stated duplicate until Feature 3); if the existing e2e helpers cannot create overlapping roots, create them with `createCollection` against `openStorage` as `rescan.spec.js` does. `file-selected` with `detail.file === null` is dispatched whenever selection is cleared (used by Task 7).
**POS:** task_0a726dae
**Done:** [x]

### Task 7: Keep or clear the selection when the tree is refreshed
**What:** Make `TreeView.update` keep the selection when the selected node id still exists and clear it (dispatching `file-selected` with `file: null`) when it does not; make `TreeView.show` clear it.
**Files:** src/renderer/tree-view.js, tests/e2e/file-selection.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/file-selection.spec.js` exits 0, with new tests asserting: after selecting a file and clicking Rescan with no change on disk, the same row is still selected and the last `file-selected` event still has that file; after deleting the selected file from the fixture on disk and clicking Rescan, no row has `aria-selected="true"` and the last `file-selected` event has `detail.file === null`; after selecting another collection (which calls `show`), no row is selected and the event reports `null`; a file whose path survives but whose node id changed (the collection was rebuilt) is not kept.
**Depends on:** 6
**Estimate:** 2
**Notes:** Covers FR-12 (and the clearing rule that FR-5 refers to). The existence test is against the rebuilt tree, not against the disk. The state held in `file-detail.js` follows the event, so it needs no change here.
**POS:** task_cb210649
**Done:** [x]

### Task 8: Keyboard navigation of the tree
**What:** Make the tree a single Tab stop with Up and Down moving a visible focus between visible rows (files and folders), and Enter or Space selecting a focused file or toggling a focused folder.
**Files:** src/renderer/tree-view.js, src/renderer/styles.css, tests/e2e/tree-keyboard.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/tree-keyboard.spec.js && npm run build` exits 0, with a test asserting: after selecting a collection, pressing Tab until the tree is focused lands on the tree once and one further Tab leaves it (single Tab stop); ArrowDown and ArrowUp move a visible focus indicator (an `aria-activedescendant` on the tree pointing at the focused row, and a `tree-focused` class on that row) across both folder rows and file rows, without wrapping past the first or last row; Enter or Space on a focused folder row expands or collapses it and does not select anything; Enter or Space on a focused file row selects it and emits `file-selected`; Space does not scroll the page; ArrowDown past the bottom of the viewport scrolls the focused row into view and the focused row is rendered even though rows are virtualized; clicking a row also sets the focus to that row.
**Depends on:** 6
**Estimate:** 3
**Notes:** Covers FR-2 (the tree half: reach by Tab, move between visible rows, select with Enter or Space) and FR-11 (Enter or Space on a folder toggles it). Focus is held as a node id in `tree-view.js` and resolved against the flattened visible rows, so it survives virtualization and `update`; if the focused id disappears after a refresh, focus falls back to the first row. Use `aria-activedescendant` on the container (`role="tree"`, `tabindex="0"`) rather than moving DOM focus between rows, because rows are created and destroyed on scroll. Each row needs a stable `id` attribute for this. No global shortcut is added (FR-2).
**POS:** task_362bb9bc
**Done:** [x]

### Task 9: Detail area below the tree (path display and disabled Reveal button)
**What:** Add the detail area below the tree with the path display, empty state and a disabled "Reveal in Finder" button, driven by the `file-selected` event.
**Files:** src/renderer/index.html, src/renderer/file-detail.js, src/renderer/styles.css, package.json (add `node --check src/renderer/file-detail.js` to `build`), tests/e2e/file-detail.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/file-detail.spec.js && npm run build` exits 0, with a test on the fixture tree asserting: before any selection `[data-testid="file-path"]` shows the empty-state text and `[data-testid="reveal"]` is disabled and labelled exactly "Reveal in Finder"; selecting a file makes `file-path` text equal that file's stored absolute path and enables the button; selecting another file updates the text; clicking a folder row leaves the text and the button state unchanged; selecting a file in an unavailable folder shows its path and keeps the button enabled, and its row still shows the "unavailable" label; for a file whose absolute path is over 300 characters (built from nested folders with long names) the page text contains the complete path (`textContent` equal to the stored path), the element has computed `overflow-wrap` of `anywhere`, no ellipsis `text-overflow`, and `scrollWidth <= clientWidth` (no horizontal scrolling needed); the path text has computed `user-select` of `text` (not `none`).
**Depends on:** 5, 6
**Estimate:** 3
**Notes:** Covers FR-3, FR-4, FR-5, FR-10 (selectable and path shown for unavailable files, label kept), FR-11 (folders do not change it) and FR-2 (the Reveal control is a native `button`, so Tab, Enter and Space work without extra code). The area sits in a new `section` below the tree (OQ-7 resolved). Load `../shared/file-detail.js` and `file-detail.js` in `index.html` after `tree-view.js`; the page's CSP is `script-src 'self'`, so no inline scripts. Render the path with `textContent`, not `innerHTML`. A path above 300 characters may exceed the length limits of some file systems per component; use several nested directories with names under 255 characters and assert the sum. If the sandbox temp directory refuses the length, record the failure rather than shortening the requirement.
**POS:** task_401eeb42
**Done:** [x]

### Task 10: Reveal button action and not-found error display
**What:** Wire the Reveal button to `window.mediaOrganizer.revealFile(selectedPath)` and show the returned error, naming the path, in the detail area.
**Files:** src/renderer/file-detail.js, src/renderer/index.html, src/renderer/styles.css
**Done when:** `npm run build` exits 0 and `npm run test:e2e -- tests/e2e/file-detail.spec.js tests/e2e/reveal-channel.spec.js` still exits 0; the button handler calls `revealFile` once per activation with the selected file's `path`; on `{ ok: false, error }` the text of `[data-testid="reveal-error"]` (an element with `role="alert"`, hidden when empty) shows the error; the error is cleared when the selection changes or is cleared; on `{ ok: true }` nothing is shown and the file and tree are unchanged; the button is disabled while its call is in flight, and the full user-visible behaviour is asserted by Tasks 11 and 12.
**Depends on:** 3, 9
**Estimate:** 2
**Notes:** Covers FR-6 (renderer sends the path of a file the app has indexed), FR-8 (renderer side of the channel), FR-9 (error shown; no rescan button and no parent-folder fallback are added: do not add either). The error text comes from `result.error`, which the main process builds from the message in Task 1 (`File not found: <path>`); the renderer does not rewrite it. Thrown IPC errors (rejected promises) are shown with the same element using the message text.
**POS:** task_9326d6a9
**Done:** [x]

### Task 11: E2E reveal flow with the mouse and with the keyboard alone
**What:** Add an e2e that selects a file and activates Reveal, once by mouse and once keyboard-only, and asserts the stubbed reveal received exactly the selected file's absolute path.
**Files:** tests/e2e/reveal-flow.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/reveal-flow.spec.js` exits 0, with tests asserting: (mouse) click a file row, click "Reveal in Finder", `revealCalls(app)` equals `[<the row's data-path>]` and the path equals the displayed `file-path` text, with no error shown and the row still selected; (keyboard only, no mouse events) Tab to the tree, move with ArrowDown to a file row, press Enter to select it, Tab to the Reveal button, press Space, and `revealCalls(app)` records the same path; with no file selected the button is disabled and pressing Enter or Space with focus elsewhere records no call; selecting a folder row and activating nothing records no call; two activations record two calls with the same path; the test runs hidden through background-main (no `MO_E2E_VISIBLE`) and uses only the stub from Task 4.
**Depends on:** 4, 8, 10
**Estimate:** 3
**Notes:** Covers FR-1, FR-2 (keyboard-only select and Reveal; no global shortcut, checked by pressing Meta+R and Ctrl+R with a file selected and asserting no call), FR-6, FR-14. The specification of the real reveal is Task 14; no test here may call the real `shell.showItemInFolder`.
**POS:** task_5cce8424
**Done:** [x]

### Task 12: E2E error cases: missing file, unavailable file, unindexed path
**What:** Add e2e tests for a file deleted from disk after indexing, a file in an unavailable folder, and a rejected unindexed path, each with the stubbed reveal.
**Files:** tests/e2e/reveal-errors.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/reveal-errors.spec.js` exits 0, with tests asserting: (missing) select a file, delete it from the fixture on disk, activate Reveal: `reveal-error` text contains the file's absolute path, `revealCalls(app)` stays `[]`, the row is still in the tree and still selected, and the stored record is unchanged (the store read through `openStorage` after closing the app still lists the path); no rescan control other than the existing Rescan button is present in the error element and no call is recorded for the parent folder; (unavailable) create a collection with a folder, remove that folder from disk, relaunch: its files show the "unavailable" label, a file is still selectable, its path is displayed, Reveal is enabled, and activating it gives the missing-file error naming the path with no recorded call; (unavailable but present) skip if the folder cannot be made unreadable without a real mode change, otherwise with a `chmod 000` folder whose file still `lstat`s: record the outcome as it is observed, asserting only that either exactly one call with the stored path or the not-found error occurs, and never a call with any other path; (unindexed) after a failed `revealFile` call for a path outside the index made through the renderer API, the displayed path, the selection and the button state are unchanged and no call is recorded (the rejection itself is asserted in Task 4).
**Depends on:** 4, 10
**Estimate:** 3
**Notes:** Covers FR-9, FR-10, FR-6 (rejection), FR-12 interplay (the selection is kept until a rescan). The chmod 000 case is deliberately written as an observation: whether `lstat` of a file inside an unreadable folder succeeds is not established in this document, so the test records whichever happens and asserts only the invariants that hold for both. Restore permissions in `afterEach`; skip with a stated reason when running as root. Run `chmod` fixtures on a copy of the fixture tree.
**POS:** task_363f3829
**Done:** [x]

### Task 13: Read-only check around select and reveal
**What:** Add an e2e that snapshots the fixture tree with `tools/readonly-check` before and after selecting files and activating the stubbed Reveal, and asserts no differences.
**Files:** tests/e2e/reveal-readonly.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/reveal-readonly.spec.js` exits 0, with a test that builds the fixture tree, creates a collection from it, takes `snapshot(root)`, launches the app, selects several files by mouse and by keyboard, activates Reveal for each (stubbed; `revealCalls` shows the calls), closes the app, takes a second snapshot, and asserts `assert(compare(before, after))` passes with no non-atime differences (including mtime, ctime, birthtime, mode, content hash and extended attributes), with the atime difference, if any, reported by the check and printed in the test output rather than failing.
**Depends on:** 11
**Estimate:** 2
**Notes:** Covers FR-13 and US-2. Reuse the pattern in `tests/e2e/full-flow.spec.js` for snapshot and compare around a run. The "selecting does not read file contents" half of FR-13 is covered by construction: the only file-system calls added by this feature are `lstat` in Task 1 and index lookups in Task 2, both asserted in those tasks' unit tests; this e2e covers the observable no-change half. Snapshotting reads the fixture, so the before and after are both taken with the app closed to keep the ordering rule in `tools/readonly-check` intact.
**POS:** task_405e513f
**Done:** [x]

### Task 14: Hands-on check of the real reveal per volume (requires the user)
**What:** Record in the repository the observed outcome of a real "Reveal in Finder" on macOS for one file on the internal drive and one file on an external or network volume.
**Files:** docs/measurements/reveal-in-finder.md
**Done when:** `docs/measurements/reveal-in-finder.md` contains one dated record for the internal drive and one for an external or network volume (or an explicit "not run: <volume type not available>" line for a volume that could not be tested), each stating: the volume label and type, whether the file was selected in the app and whether the path shown matched the file, pass or fail for "Finder opened with the folder shown and the file selected", and what Finder showed in plain observed terms; the file contains no statement of cause for any outcome (observed outcomes only).
**Depends on:** 10
**Estimate:** 2
**Notes:** Covers FR-15. This task requires the user: it needs a real, visible, non-background app run (`npm start`) on the user's Mac and the user watching Finder, with an external or network volume attached. It must not be done by an agent through background-main or any stub, and it does not block Tasks 1 to 13 or 15; it only needs the working UI from Task 10. The external drive on this machine previously returned `EPERM` for `mkdtemp` and `ls` (see `docs/measurements/atime-cat-read.md`); that is a measurement from a different operation and is not assumed to predict the reveal outcome: run the check and record what happens. Follow the format of the existing records in `docs/measurements/`.
**POS:** task_9ff1f0b7
**Done:** [ ]

### Task 15: README note for Reveal in Finder and its test stub
**What:** Add a short README section stating what the Reveal action does, that it is macOS-only, and that e2e tests stub it.
**Files:** README.md
**Done when:** `README.md` contains a section that names "Reveal in Finder", states the action only reveals and does not modify files, states that e2e tests stub `shell.showItemInFolder` in `tests/support/background-main.js` and read the calls with `revealCalls`, and points to `docs/measurements/reveal-in-finder.md` for the hands-on result; `npm test` still exits 0.
**Depends on:** 11, 12
**Estimate:** 1
**Notes:** Covers FR-7, FR-14 (documentation of the test seam) only as far as tests need; fuller documentation is handled later by the scribe. Do not state the hands-on outcome in the README until Task 14 is done; link to the file instead.
**POS:** task_9ca43748
**Done:** [x]

## Summary
- Total tasks: 15
- Total estimated effort: 36
- Parallel waves: (1) Tasks 1, 2, 5, 6; (2) Tasks 3, 7, 8, 9; (3) Tasks 4, 10; (4) Tasks 11, 12, 14 (14 needs the user and can happen any time after 10); (5) Tasks 13, 15.
- Critical path: Tasks 1 → 3 → 4 → 11 → 13 (2 + 3 + 3 + 3 + 2 = 13 points); Tasks 6 → 9 → 10 → 11 → 13 is equally long (3 + 3 + 2 + 3 + 2 = 13).
- Risks: Task 14 depends on the user's hardware and attention, and the external drive has previously refused file operations; its outcome is unknown until run. Task 12's unreadable-folder case depends on a file-system behaviour that is not established here, so it is written as an observation. Task 9's over-300-character path depends on the temp directory accepting long nested paths. Task 8 is the largest UI risk: keyboard focus on a virtualized list uses `aria-activedescendant`, and row rendering must keep the focused row in the DOM.
- FR coverage: FR-1 (6, 11), FR-2 (8, 9, 11), FR-3 (5, 9), FR-4 (5, 9), FR-5 (5, 7, 9), FR-6 (2, 3, 4, 10, 11, 12), FR-7 (1, 15), FR-8 (1, 3, 10), FR-9 (1, 3, 10, 12), FR-10 (1, 2, 9, 12), FR-11 (5, 6, 8, 9), FR-12 (7, 12), FR-13 (1, 13), FR-14 (4, 11, 15), FR-15 (14), FR-16 (1, 3, 5).

## Open Questions
None.
