# Tasks: Browse by media type

**Spec:** `specs/features/type-views.md`
**Branch:** `feat/type-views`
**Estimation unit:** story points (1/2/3/5/8)

Conventions: every task names the FRs it covers in its Notes. Test commands use the existing npm scripts (`npm test` runs Vitest; `npm run test:e2e` runs Playwright; `npm run build` runs `node --check` over the listed files, so every new source file under `src/` must be added to the `build` script in `package.json` in the task that creates it; several tasks therefore touch the same `package.json` line and must run one after another). E2E tests launch the app with `launchApp` from `tests/support/e2e-app.js`, which runs it through `tests/support/background-main.js` (hidden window, accessory activation policy, `shell.showItemInFolder` stubbed and recorded, read with `revealCalls`), so no window is brought to the front. Where a task says "relaunch" it closes the app and reopens it on the same user data dir.

Design decisions made by this breakdown (they follow from the spec and the shipped code, not from new product choices):
- No main-process or IPC change. Lists are built in the renderer from the `view.files` that `collections:getView`, `collections:rescan`, `collections:addFolders`, `collections:addFolder` and `collections:removeFolder` already return (spec FR-10, OQ-6). The per-load payload is not reduced here.
- Shared pure modules, dual-use like `src/shared/tree-model.js` (CommonJS under Node/Vitest, a global in the renderer, no `fs` or `path`): `tree-model.js` gains the extracted owner rule and exports `compareNames`; `src/shared/type-list.js` (global `TypeList`) builds a sorted list of one kind; `src/shared/type-list-cache.js` (global `TypeListCache`) holds the lazy per-load cache; `src/shared/list-window.js` (global `ListWindow`) holds the windowing arithmetic; `src/shared/tabs-model.js` (global `TabsModel`) holds the tab keyboard rules. Modules that use another shared global take it the way `tree-model.js` takes `PathCompare`: `require` under Node, `globalThis.X` in the renderer. Each new shared script is added to `src/renderer/index.html` and checked by `tests/unit/renderer-scripts.test.js` (Task 8).
- Renderer modules: `src/renderer/list-view.js` (global `ListView`, one virtualized list, Tasks 6 and 7), `src/renderer/view-tabs.js` (the tab row, Task 8) and `src/renderer/type-views.js` (global `TypeViews`, the controller with `show`, `update` and `clear` that every place calling `TreeView.show` or `TreeView.update` also calls, Task 9).
- Test ids chosen here: tabs `view-tab-tree`, `view-tab-image`, `view-tab-audio`, `view-tab-video`, `view-tab-document` (tab ids are the kinds, labels are Tree, Images, Audio, Video, Documents); the view area `view-area`; the list `list-view`, its rows `list-row` (with `data-node-id`), the dimmed folder part `list-row-folder`, the empty text `list-empty`, the loading text `list-loading`; the Rescan section `rescan-section`.
- A list row's node id is `<rootFolderId>:<relativePath>`, the tree's id, so `file-selected` carries the same `detail.file` shape from either view.
- Switching view clears the selection (spec FR-7, OQ-3): the controller calls the list view's `clearSelection`, which dispatches `file-selected` null when something was selected. The tree's expansion and scroll are untouched (the tree container is hidden, not rebuilt).

### Task 1: Extract the one-appearance rule from buildTree
**What:** Pull the owner rule out of `buildTree` into an exported function in `src/shared/tree-model.js` that returns the file records each root keeps, and make `buildTree` use it; also export `compareNames`.
**Files:** src/shared/tree-model.js, tests/unit/tree-model.test.js
**Done when:** `npx vitest run tests/unit/tree-model.test.js` exits 0 with every existing test unchanged and passing, and new tests asserting: `ownedFiles(folderRecords, fileRecords)` returns, per folder id, the file records that root owns; for nested roots the outer root keeps the file and the inner root drops it only when the outer root has a record for the same path; for identical-path roots the earliest in the given folder order keeps it; a case-differing pair is kept distinct in both roots; a file whose owner has no record for it stays with the inner root; the union of the lists of all roots holds each absolute path at most once and loses none that `buildTree` shows; `buildTree(folders, files)` output is deep-equal to the output before the change for a nested, an identical-root and a flat fixture (compare against a copy of the old output stored in the test); `TreeModel.compareNames` is exported and orders `file2` before `file10` and `A` equal-first to `a` by the tie-break.
**Depends on:** none
**Estimate:** 3
**Notes:** Covers FR-2 (the rule is implemented once and used by both the tree and the lists) and FR-13 (shared rule tests). A behaviour-preserving refactor: do not change what `buildTree` returns. Keep case-sensitive keys over `resolvedPath || path`. Update the header comment of `tree-model.js`.
**POS:** task_6a547f3b
**Done:** [x]

### Task 2: Type-list model
**What:** Add `src/shared/type-list.js` with `buildTypeList(folders, files, kind)` returning the rows of one kind, one per file, de-duplicated by the shared rule and sorted for display.
**Files:** src/shared/type-list.js, tests/unit/type-list.test.js, package.json (add `node --check src/shared/type-list.js` to `build`)
**Done when:** `npx vitest run tests/unit/type-list.test.js && npm run build` exits 0, with tests asserting: for each of the kinds `image`, `audio`, `video` and `document` the list holds exactly the files of that kind and no file of another kind or another collection; a RAW file (kind `image`, e.g. `.cr2`) is in the image list and a file with an uppercase extension is listed under its stored kind; a `.txt` file is in the document list; each row carries `nodeId` (`<rootFolderId>:<relativePath>`), `path`, `name`, `folderId`, `relativePath`, `kind`, `unavailable` and a `folder` label that is the file's directory relative to its root (`''` shown as the root folder's name for a top-level file, `Photos/2024` for a nested one); order is `compareNames` on the name (`img2` before `img10`, `a` and `B` case-insensitive) with ties by absolute path (two `IMG_1.jpg` from different folders both present, ordered by path, and the same input gives the same order on repeated calls); for nested roots, identical-path roots and a case-differing pair the set of paths equals the set of file nodes `buildTree` shows for the same input, with no path twice and none missing; a file of an unavailable folder is listed with `unavailable: true`; an empty input gives `[]`; an unknown kind throws; the module loads as `module.exports` under Node and as `globalThis.TypeList` when `module` is undefined (checked in a `vm` context after loading `tree-model.js` the same way).
**Depends on:** 1
**Estimate:** 3
**Notes:** Covers FR-1, FR-2, FR-4, FR-8 (unavailable flag) and FR-13 (selection of files by kind, order and tie-break, shared rule). Use `TreeModel.ownedFiles` and `TreeModel.compareNames` from Task 1. Do not mutate the input arrays.
**POS:** task_524b7ea9
**Done:** [x]

### Task 3: Per-load list cache
**What:** Add `src/shared/type-list-cache.js` with `createTypeListCache()`: lazy per-kind lists, built on first request and kept until the data is replaced.
**Files:** src/shared/type-list-cache.js, tests/unit/type-list-cache.test.js, package.json (add `node --check src/shared/type-list-cache.js` to `build`)
**Done when:** `npx vitest run tests/unit/type-list-cache.test.js && npm run build` exits 0, with tests asserting: before any `get(kind)` the build function is never called; the first `get('image')` calls it once and returns the list; a second `get('image')` returns the same array without a second call; `get('audio')` calls it for `audio` only, so unopened kinds are never built; `setData(folders, files)` with new arrays drops every cached list so the next `get` rebuilds from the new data; `clear()` drops all lists and the data and `get` then returns `[]`; two caches do not share state; with an injected build function the cache returns the function's result unmodified; the module loads under Node and as `globalThis.TypeListCache`.
**Depends on:** 2
**Estimate:** 2
**Notes:** Covers FR-10 (lazy, cached per collection load, invalidated on rebuild) and FR-9 (one update path, `setData`, that Feature 5 can feed). Default build function is `TypeList.buildTypeList`; the injection is for the test.
**POS:** task_2fde479d
**Done:** [x]

### Task 4: Windowing arithmetic
**What:** Add `src/shared/list-window.js` with `windowFor({ scrollTop, viewportHeight, rowCount, rowHeight, buffer })` returning the first and last row index to render, the spacer height and a row's top offset.
**Files:** src/shared/list-window.js, tests/unit/list-window.test.js, package.json (add `node --check src/shared/list-window.js` to `build`)
**Done when:** `npx vitest run tests/unit/list-window.test.js && npm run build` exits 0, with tests asserting: for 0 rows the rendered count is 0 and the spacer height is 0; for 1 row the rendered count is 1; for a viewport's worth of rows (viewport 480, row height 24) the rendered count is the viewport rows plus the buffer on the side that has rows; for 500,000 rows at scrollTop 0, in the middle and at the very end the rendered count is at most `ceil(viewportHeight / rowHeight) + 2 * buffer + 1` and does not grow with `rowCount`; the spacer height is `rowCount * rowHeight`; at the maximum scroll the last row index is `rowCount - 1`; a scrollTop past the end or negative is clamped; `ensureVisible(index, ...)` returns the scrollTop that brings a row at index 0, 250,000 and 499,999 into view and leaves scrollTop unchanged for a row already visible; the module loads under Node and as `globalThis.ListWindow`.
**Depends on:** none
**Estimate:** 2
**Notes:** Covers FR-3 (rows in the DOM depend on viewport and buffer, not on file count; the whole range reachable) and FR-13 (windowing arithmetic for 0, 1, a viewport's worth and 500,000 rows). Same constants as the tree (24px rows, buffer 5) are the defaults. Pure; the tree view keeps its own code and is not changed.
**POS:** task_af621a08
**Done:** [x]

### Task 5: Tab keyboard model
**What:** Add `src/shared/tabs-model.js` with the pure rules for the tab row's keyboard behaviour and the tab list definition.
**Files:** src/shared/tabs-model.js, tests/unit/tabs-model.test.js, package.json (add `node --check src/shared/tabs-model.js` to `build`)
**Done when:** `npx vitest run tests/unit/tabs-model.test.js && npm run build` exits 0, with tests asserting: `TABS` lists, in order, `tree` (label Tree), `image` (Images), `audio` (Audio), `video` (Video), `document` (Documents); `nextTab(index, key, count)` returns index+1 for `ArrowRight` and index-1 for `ArrowLeft` with wrap-around at both ends, `0` for `Home`, `count - 1` for `End`, and `null` for any other key; `emptyText('image')` is "No image files in this collection", and likewise "audio", "video" and "document" for the other kinds; `emptyText('tree')` throws; the module loads under Node and as `globalThis.TabsModel`.
**Depends on:** none
**Estimate:** 2
**Notes:** Covers FR-1 (WAI-ARIA tabs pattern keys) and FR-8 (the empty text, with the kind in plain words). Automatic activation on arrow keys is allowed by the pattern; the view tabs in Task 8 decide whether focus alone activates. Keep wording in one place so the e2e tests and the UI agree.
**POS:** task_008ada30
**Done:** [x]

### Task 6: List view, rendering
**What:** Add `src/renderer/list-view.js` (global `ListView`): a virtualized one-column list with name and dimmed folder per row, a spacer for the whole range, and the empty, loading and unavailable states.
**Files:** src/renderer/list-view.js, src/renderer/styles.css, package.json (add `node --check src/renderer/list-view.js` to `build`)
**Done when:** `npm run build` exits 0, and `npm run test:e2e -- tests/e2e/list-view-render.spec.js` exits 0, where the new spec launches the app (`launchApp`, hidden), loads a rendered fixture of 3 image rows through a test hook that calls `ListView.render(container, rows)`, and asserts: exactly the rows given are in the DOM as `list-row` elements with the name text and a `list-row-folder` element holding the folder label; with 2,000 generated rows the number of `list-row` elements in the DOM is at most the viewport rows plus 11 and the container's scroll height equals `2000 * 24`; scrolling to the bottom puts the last row in the DOM; with zero rows the container shows a `list-empty` element with the text given; with `ListView.setLoading(true)` it shows `list-loading` and no rows; a row with `unavailable: true` shows the visible "unavailable" label the tree uses and is still present; row text is set with `textContent` (a name containing `<b>x</b>` shows literally).
**Depends on:** 2, 4
**Estimate:** 5
**Notes:** Covers FR-3, FR-4 (one-line row, folder as the dimmed second part), FR-8 (unavailable label, empty text, no hiding) and FR-13. Keep the structure of `tree-view.js` (absolute rows, spacer, scroll listener) and use `ListWindow.windowFor`. The test hook is a temporary global used only by this spec; Task 9 replaces it with the real controller, and this spec keeps testing `ListView` directly. Selection and keyboard are Task 7. The shared scripts it needs are loaded by Task 8's `index.html`; until then the spec loads the page with the script tags added in this task's own commit, to be merged with Task 8's.
**POS:** task_c676d91e
**Done:** [x]

### Task 7: List view, selection and keyboard
**What:** Add selection by node id, `file-selected` dispatch, the keyboard model and the ARIA roles to `ListView`.
**Files:** src/renderer/list-view.js, tests/e2e/list-view-select.spec.js
**Done when:** `npm run build && npm run test:e2e -- tests/e2e/list-view-select.spec.js` exits 0, with assertions on a list of 2,000 generated rows that: the container has `role="listbox"`, `tabindex="0"` and is the only Tab stop of the list, rows have `role="option"`, and `aria-activedescendant` names the focused row; clicking a row sets `aria-selected="true"` on it only and dispatches `file-selected` on `document` once with `detail.file` holding `nodeId`, `path`, `name`, `folderId`, `relativePath`, `kind`, `unavailable` equal to the row's values; Enter and Space on the focused row select it; ArrowDown and ArrowUp move focus one row without wrapping and scroll it into view; End focuses and scrolls to row 2,000 (rendered, `aria-selected` unchanged) and Home returns to row 1; the focused row stays rendered after scrolling far away; the selection is held by node id: after scrolling the selected row out of the window and back it is still `aria-selected`, and after `ListView.render` with new rows that still contain the id it stays selected while a new row set without the id clears it and dispatches `file-selected` with `detail.file` null; `ListView.clearSelection()` dispatches null once when something was selected and nothing when not.
**Depends on:** 6
**Estimate:** 5
**Notes:** Covers FR-5, FR-6 and FR-7 (id-based selection, kept on rebuild only if the id exists) and FR-13. Reuse the detail shape built by `tree-view.js` (same keys). Selecting does not open or alter anything on disk. A selection made in a list is a node id from `TypeList` rows (Task 2).
**POS:** task_0ce63f1b
**Done:** [x]

### Task 8: Page layout and view tabs
**What:** Restructure `src/renderer/index.html` into a Rescan section above a tab row and one shared view area, add `src/renderer/view-tabs.js`, and load the new shared scripts.
**Files:** src/renderer/index.html, src/renderer/view-tabs.js, src/renderer/styles.css, tests/unit/renderer-scripts.test.js, package.json (add `node --check src/renderer/view-tabs.js` to `build`)
**Done when:** `npx vitest run tests/unit/renderer-scripts.test.js && npm run build && npm run test:e2e -- tests/e2e/view-tabs.spec.js` exits 0, with the unit test listing `../shared/type-list.js`, `../shared/type-list-cache.js`, `../shared/list-window.js` and `../shared/tabs-model.js` among the loaded scripts and asserting `typeof TypeList`, `TypeListCache`, `ListWindow` and `TabsModel` are `object` in one shared context; and the new e2e spec asserting: the page has no section headed "Tree"; the Rescan button and its status are inside `rescan-section`, which comes before the tab row in the document and stays visible and (with a collection selected) enabled while each of the five tabs is active; the tab row has `role="tablist"` with five `role="tab"` elements labelled Tree, Images, Audio, Video and Documents; the view area has `role="tabpanel"` and `aria-labelledby` the active tab; exactly one tab has `aria-selected="true"` and it starts as Tree; clicking a tab selects it and shows only its panel content (the tree container for Tree, the list container for the others); only the selected tab has `tabindex="0"`; with focus on a tab ArrowRight and ArrowLeft move focus and wrap, Home and End go to first and last, and Enter or Space activates the focused tab; no tab or list is shown before a collection is selected (the tab row is disabled or hidden, the tree area shows nothing, as today).
**Depends on:** 5, 6
**Estimate:** 3
**Notes:** Covers FR-1 and FR-11 (no collection at launch, no list shown) and the OQ-8 placement. Keep the `tree-view` test id and the Rescan button's ids unchanged so the existing e2e tests still pass; the heading "Tree" is renamed (for example "Files"). `view-tabs.js` only manages tab state and the panel visibility and dispatches `view-changed` on `document` with `detail.view`; the data is wired in Task 9. Run `npm run test:e2e -- tests/e2e/tree-view.spec.js tests/e2e/rescan.spec.js` to confirm the layout change did not break them. Edits `index.html`, which Task 6 also touched for script tags: merge, do not duplicate.
**POS:** task_6bf809b3
**Done:** [x]

### Task 9: Type view controller and wiring
**What:** Add `src/renderer/type-views.js` (global `TypeViews`) that feeds the lists from the collection view, computes a kind lazily on its tab's first open with a loading state, discards stale results, and clears the selection on a view switch; call it wherever the tree is shown, updated or cleared.
**Files:** src/renderer/type-views.js, src/renderer/create-collection.js, src/renderer/collection-manage.js, src/renderer/rescan-button.js, src/renderer/index.html, tests/e2e/type-views-wiring.spec.js, package.json (add `node --check src/renderer/type-views.js` to `build`)
**Done when:** `npm run build && npm run test:e2e -- tests/e2e/type-views-wiring.spec.js tests/e2e/tree-view.spec.js tests/e2e/rescan.spec.js tests/e2e/collection-switch.spec.js tests/e2e/folder-add.spec.js tests/e2e/folder-remove.spec.js` exits 0, with the new spec asserting, on a fixture collection created through the UI: selecting the Images tab shows the image files of every folder at any depth and no audio, video or document file, and likewise for the other three tabs; the first open of a tab shows `list-loading` before the rows (check by holding the sort with a test-only delay hook and asserting `list-loading`, then releasing it); opening the same tab again does not rebuild (a build counter exposed to the test stays at 1 for the kind) while opening another kind builds that kind once; a rescan of the collection, an add-folder, a remove-folder and selecting another collection each reset the counters (the next open rebuilds) and the lists show the new data; the list shows exactly the same set of file paths as the tree for the same collection; switching tabs while a file is selected clears the selection (the detail area shows its empty state and `file-selected` null was dispatched) and returning to Tree shows it unselected with the same expanded folders and scroll position as before the switch; a response computed for a collection that is no longer active is discarded (select collection B right after opening a list of A: the rows are B's); the other existing specs listed above still pass.
**Depends on:** 3, 7, 8
**Estimate:** 5
**Notes:** Covers FR-1, FR-7 (clear on collection change and on switch, keep on rebuild only if the id exists), FR-9 (one update path: `TypeViews.show(view)` for a collection load and `TypeViews.update(view)` for rescan/add/remove, called next to `TreeView.show` and `TreeView.update` at `create-collection.js:78`, `:138`, `collection-manage.js:151` and `rescan-button.js:51`), FR-10 (renderer-built, lazy, cached, loading state, token against stale results) and FR-11 (no scan or store write on a switch). Yield to the event loop (a `setTimeout` 0 or `requestAnimationFrame`) between showing the loading state and sorting so the state can paint. The measured cost (spec OQ-6: sorting 250k files of one kind took 678-743 ms on synthetic data) is why the loading state exists; do not add a worker. Implement the test-only delay and counter hooks behind a flag that only the e2e launch sets.
**POS:** task_413487b3
**Done:** [x]

### Task 10: Large fixture generator for e2e
**What:** Add `tests/support/large-fixture.js` that creates a temp folder tree with a requested number of empty supported files spread across kinds and nested directories, plus its cleanup.
**Files:** tests/support/large-fixture.js, tests/unit/large-fixture.test.js
**Done when:** `npx vitest run tests/unit/large-fixture.test.js` exits 0, with tests asserting: `buildLargeFixture({ files: 10000 })` returns `{ root, counts }` where the files exist under `root` and `counts.image + counts.audio + counts.video + counts.document` is 10000 with every count above 0; files are spread over at least 20 directories at depth 2 or more; names include numbers that exercise natural order (`img1`, `img2`, `img10`); it includes some RAW (`.cr2`), an uppercase extension (`.JPG`) and a `.txt`; a second call gives a different root; `cleanupLargeFixture(root)` removes the tree and refuses a path that is not a directory this module created (outside the temp dir or without its marker file); a `files: 0` call returns an empty root.
**Depends on:** none
**Estimate:** 2
**Notes:** Covers FR-13 (a generated fixture of at least 10,000 files for the e2e). Follow the guard style of `tests/support/fixture-tree.js` (`assertInsideFixture`). Files are empty; the scanner only needs names and extensions.
**POS:** task_e62cf2c0
**Done:** [x]

### Task 11: E2E lists, order and states
**What:** Add `tests/e2e/type-views.spec.js` covering each view through the UI: contents, row shape, order, ties, empty state, unavailable label and the Documents kind.
**Files:** tests/e2e/type-views.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/type-views.spec.js` exits 0, with the spec using the fixture tree and asserting through the UI: each of Images, Audio, Video and Documents lists every file of its kind from all folders (names and folder labels compared with the fixture manifest), including a RAW file and an uppercase-extension file under Images and `.pdf`, `.txt`, `.epub` and `.cbz` files under Documents, and no file of another kind; a top-level file's folder part shows the root folder's name and a nested one shows its relative path; the rows are in `compareNames` order (a `img2` before `img10` case) and two files with the same name in different folders both appear, ordered by absolute path, with different folder parts; a collection with no video file shows "No video files in this collection" in `list-empty` and no rows, and the same for the other three kinds in a second collection; a collection with a folder made unavailable (folder removed from disk before launch, as the existing unavailable specs do) lists its files with the "unavailable" label and does not hide them; a file with an unsupported extension in the fixture appears in no list and no skipped count is shown anywhere; the Rescan button works from the Images view and the list shows a file added on disk after the rescan.
**Depends on:** 9
**Estimate:** 5
**Notes:** Covers FR-1, FR-4, FR-8, FR-13 and the OQ-1, OQ-2, OQ-4, OQ-5, OQ-7 and OQ-8 outcomes. Rows are virtualized, so use scrolling or `End` for lists longer than the window; the fixture is small enough to stay inside one window. Reuse `buildFixtureTree`, `cleanupFixtureTree` and the helpers of `tests/support/e2e-app.js`; stub the folder picker with `stubFolderPicker`.
**POS:** task_b36f71ba
**Done:** [x]

### Task 12: E2E selection, detail and Reveal from lists
**What:** Add `tests/e2e/type-views-select.spec.js` checking that selecting a file in a list drives the detail area and Reveal in Finder, by click and by keyboard, and that a switch clears the selection.
**Files:** tests/e2e/type-views-select.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/type-views-select.spec.js` exits 0, with the spec asserting for each of the four lists: clicking a row shows that file's full path in the detail area and enables Reveal in Finder, and pressing the button records exactly one call in `revealCalls` with that file's absolute path; moving with ArrowDown and selecting with Enter, and with Space, does the same for the focused row; only one row is `aria-selected` at a time; selecting a file, switching to another tab and back to the list shows nothing selected and the detail area in its no-selection state with Reveal disabled; selecting in the tree and then opening Images shows no selection; selecting a file of an unavailable folder shows the same error behaviour as in the tree when Reveal fails (stub a failure through the existing reveal-error mechanism of `tests/e2e/reveal-errors.spec.js`); after a rescan with the file still present the selection remains, and after the file is deleted on disk before the rescan the selection is cleared; selecting another collection clears the selection.
**Depends on:** 9
**Estimate:** 3
**Notes:** Covers FR-5, FR-7, FR-11 and FR-13; reuses Feature 2's contract (the detail area reads only `file-selected`). Use `resetRevealCalls` between steps. `shell.showItemInFolder` is stubbed by `background-main.js`, so no Finder window opens.
**POS:** task_3d289e50
**Done:** [x]

### Task 13: E2E large list virtualization
**What:** Add `tests/e2e/type-views-large.spec.js` checking a list over at least 10,000 generated files stays bounded in the DOM and that the last row is reachable with End.
**Files:** tests/e2e/type-views-large.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/type-views-large.spec.js` exits 0, with the spec building `buildLargeFixture({ files: 10000 })`, creating a collection over it through the UI, and asserting: opening the largest kind's tab leaves at most (viewport rows + 11) `list-row` elements in the DOM, measured from the container's height, and the scroll height equals `count * 24` where `count` is the fixture's count for that kind; focusing the list and pressing End makes the last row (by `compareNames` then path, computed in the test from the fixture) rendered, focused and in view, and the number of `list-row` elements is still bounded; Home returns to the first row; scrolling to the middle by setting `scrollTop` renders rows of that region only; the same bound holds for the three other kinds; the test records the time to first render of the largest list in its output without asserting a threshold (no performance target is promised, product FR-20).
**Depends on:** 9, 10
**Estimate:** 3
**Notes:** Covers FR-3, FR-6 (End/Home) and FR-13. The scan of 10,000 files takes a while: set `test.setTimeout(180000)` and wait for the collection's tree to appear before opening a tab. Clean the fixture with `cleanupLargeFixture` in `afterAll`.
**POS:** task_60dd9383
**Done:** [x]

### Task 14: E2E one appearance on a legacy nested store
**What:** Add `tests/e2e/type-views-dedup.spec.js` checking that lists show each file once on a store seeded with nested and identical roots.
**Files:** tests/e2e/type-views-dedup.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/type-views-dedup.spec.js` exits 0, with the spec seeding `<userDataDir>/store.json` as `tests/e2e/dedup.spec.js` does (two folder records of one collection, outer and inner, real scanner output) and asserting: in every one of the four lists each file under the inner root appears exactly once (count of `list-row` with that path, using `End` or scrolling where needed); the set of file paths in each list equals the set of file paths the tree shows under the roots of the same collection (read from the tree with the existing node-id helpers); no file of the inner root is missing from all lists; a second seeded collection with two identical-path roots shows each file once; a case-differing pair of folders (on a case-sensitive fixture where available, otherwise skipped with a recorded reason) lists both files; removing the outer root through the panel makes the inner root's files appear in the lists after the refresh, with no change to the store besides the removal.
**Depends on:** 9
**Estimate:** 2
**Notes:** Covers FR-2, FR-9 and FR-13 (legacy store test). Seed the data with `openStorage` as `dedup.spec.js` does; the UI cannot build these shapes any more.
**POS:** task_b61c6264
**Done:** [x]

### Task 15: E2E refresh and tree state across views
**What:** Add `tests/e2e/type-views-refresh.spec.js` checking that rescan, add-folder, remove-folder and replace refresh the lists consistently with the tree, and that the tree's expansion and scroll survive view switches.
**Files:** tests/e2e/type-views-refresh.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/type-views-refresh.spec.js` exits 0, with the spec asserting: with the Audio list open, a file added on disk appears after Rescan and a file deleted on disk disappears, and the tree (opened afterwards) shows the same set; adding a folder through the panel adds its files to the Images list and removing it removes them; a replace-on-contains add (confirmation stubbed true with `stubConfirm`) leaves each file once in the lists; no list shows a file the tree does not and no tree file of a listed kind is missing from the lists, compared by absolute path after each action; expanding three folders and scrolling the tree, opening Documents and returning to Tree shows the same expanded folders and the same scroll position; switching tabs five times in a row triggers no scan (the `collections:rescan` channel count, read through `gateChannel` or `ipc-wrap.js`, stays 0) and no write of `store.json` (modification time and bytes unchanged); the app stays usable after quit and relaunch with the last view not remembered (Tree is active at launch and no collection is selected).
**Depends on:** 9
**Estimate:** 3
**Notes:** Covers FR-9, FR-11 and FR-13. Use `gateChannel` from `tests/support/e2e-app.js` and `ipc-wrap.js` to observe channels; read `store.json` while the app is idle.
**POS:** task_25bd76d7
**Done:** [x]

### Task 16: Read-only check around the type views
**What:** Add `tests/e2e/type-views-readonly.spec.js` running the read-only check around a flow that opens all four views, scrolls, selects and reveals.
**Files:** tests/e2e/type-views-readonly.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/type-views-readonly.spec.js` exits 0, with the spec following `tests/e2e/management-readonly.spec.js`: build the fixture tree, create a collection over it through the service, take the read-only snapshot `before` with the app closed, launch, select the collection, open Tree, Images, Audio, Video and Documents in turn, scroll each list to the end and back, select a file in each by click and by keyboard, press Reveal in Finder for each (recorded by the stub, `revealCalls` has four entries), switch back to Tree, quit, take the snapshot `after` with the app closed, and `assert(compare(before, after))` passes with no non-atime differences, any atime differences attached to the test output and logged and never failing the test; the spec also confirms each step ran (rows were present in each list, four reveal calls recorded) so an idle flow cannot pass.
**Depends on:** 9
**Estimate:** 3
**Notes:** Covers FR-12 and US-4 (product FR-17). Uses `tools/readonly-check/index.js` as `management-readonly.spec.js` does; the app is closed for both snapshots. Do not add a check that runs while the app is open.
**POS:** task_a3534ed7
**Done:** [x]

### Task 17: README and full verification
**What:** Add type views to the README feature list and run the whole unit, build and e2e suites.
**Files:** README.md
**Done when:** `npm test && npm run build && npm run test:e2e` exits 0 with no test skipped except the recorded case-sensitivity skip of Task 14, and `grep -n "Images" README.md` finds the line describing browsing by type (Images, Audio, Video and Documents lists, selection and Reveal, read-only); `git status --short` shows no changes outside `src/`, `tests/`, `specs/`, `README.md` and `package.json`.
**Depends on:** 11, 12, 13, 14, 15, 16
**Estimate:** 2
**Notes:** Covers FR-13 as a whole and the README line recorded in the spec's state section. No numeric performance claim in the README (product FR-20). If a spec scenario fails, fix it in the task that owns the behaviour rather than here.
**POS:** task_f6e38e1b
**Done:** [x]

## Summary
- Total tasks: 17
- Total estimated effort: 53 story points
- Critical path: Tasks 1 → 2 → 6 → 7 → 9 → 11 → 17
- Risks: Task 9 carries the wiring across three existing renderer files, the lazy loading state and the stale-result token, and is the task every e2e task depends on. The first-open sort is the one cost with a recorded measurement (678-743 ms for 250k files of one kind on synthetic data), so a real collection may behave differently; the loading state in Task 9 is the mitigation and Task 13 only records first-render time. Tasks 6 and 8 both edit `index.html`, and Tasks 2 to 5, 6, 8 and 9 all edit the `build` line of `package.json`, so they must be merged or run one after another. Task 14 depends on a case-sensitive volume for one assertion and records a skip otherwise. Task 1 is a refactor of code the tree and Feature 3 rely on; its before/after equality test is the guard.
- FR coverage: FR-1 (2, 5, 8, 9, 11), FR-2 (1, 2, 14), FR-3 (4, 6, 13), FR-4 (2, 6, 11), FR-5 (7, 12), FR-6 (7, 13), FR-7 (7, 9, 12), FR-8 (5, 6, 11), FR-9 (3, 9, 14, 15), FR-10 (3, 9), FR-11 (8, 9, 12, 15), FR-12 (16), FR-13 (all)

## Open Questions
None.
