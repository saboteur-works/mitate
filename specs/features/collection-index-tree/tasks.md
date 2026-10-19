# Tasks: Index a folder collection and browse its tree

**Spec:** `specs/features/collection-index-tree.md`
**Branch:** `feat/collection-index-tree`
**Estimation unit:** story points (1/2/3/5/8)

Conventions: every task names the FRs it covers in its Notes. Test commands assume the npm scripts created in Task 1 (`npm test` runs Vitest; `npm run test:e2e` runs Playwright). `tools/format-probe/` is a throwaway probe and is not built on.

### Task 1: Scaffold Electron app with Vitest, Playwright and smoke e2e
**What:** Create the plain-JavaScript npm Electron 44 app for macOS with launch, build and test commands, Vitest, Playwright and one smoke e2e test that launches the app.
**Files:** package.json, src/main/main.js, src/renderer/index.html, src/renderer/renderer.js, vitest.config.js, playwright.config.js, tests/e2e/smoke.spec.js, tests/unit/sanity.test.js, .gitignore
**Done when:** `npm install && npm test && npm run build && npm run test:e2e` exits 0, where the e2e smoke test launches the Electron app through Playwright's Electron support and asserts the window opens with a title; `npm start` launches the app.
**Depends on:** none
**Estimate:** 3
**Notes:** Covers FR-19. This task verifies the unverified compatibility of Playwright's Electron support with Electron 44 (OQ-9); if it fails, record the failure output and report it rather than switching framework silently. Risk: the Electron binary download from npm may fail in the sandbox (previously the zip had to be fetched from GitHub releases); this task records the outcome and does not solve it in the spec.
**Done:** [ ]

### Task 2: Fixture tree builder
**What:** Provide a script that builds the FR-17 fixture tree in a temp directory (four-plus nested levels, supported and unsupported files, hidden file and folder, package bundle, symlink to a folder, symlink to a file, files with extended attributes).
**Files:** tests/support/fixture-tree.js, tests/unit/fixture-tree.test.js
**Done when:** `npx vitest run tests/unit/fixture-tree.test.js` exits 0, with assertions that each listed element exists in the built tree (depth of at least 4, a dot-file and dot-folder, a `.app` directory, both symlink kinds, at least one file with an xattr read back).
**Depends on:** 1
**Estimate:** 2
**Notes:** Covers the fixture part of FR-17; reused by Tasks 6, 8 and 16. Uses `xattr` via child process on macOS.
**Done:** [ ]

### Task 3: Supported-type registry
**What:** Implement the registry module with one data table, lookup from extension to entry and listing by kind, containing exactly the FR-10 table.
**Files:** src/main/registry/types.js, tests/unit/registry.test.js
**Done when:** `npx vitest run tests/unit/registry.test.js` exits 0, asserting the exact set of registered extensions from FR-10, no duplicate extension, each entry has exactly one kind, RAW entries are kind image with subtype RAW, and jxl, caf, ac3, ts, mts, m2ts are absent.
**Depends on:** 1
**Estimate:** 2
**Notes:** Covers FR-9, FR-10. Lookup is on lowercase extension; case-insensitive matching of file names is applied by the caller (Task 8) or by a helper here.
**Done:** [ ]

### Task 4: Storage module
**What:** Implement the single storage module (JSON file store) for collection records, folder records with absolute paths, the file index and folder-access data, with a storage location configurable in one place.
**Files:** src/main/storage/index.js, tests/unit/storage.test.js
**Done when:** `npx vitest run tests/unit/storage.test.js` exits 0, covering: write then reopen (new instance on the same path) returns the same collections, folders and index; location is set only through one config entry; default location resolves outside any given collection folder; no other module needs to read the store file (the module exposes only an API).
**Depends on:** 1
**Estimate:** 3
**Notes:** Covers FR-2 (persistence at the storage level), FR-3 (folder-access data goes through this module), FR-18, FR-13 (storage outside collection folders). Known risk: a JSON store is not expected to scale to hundreds of thousands of files (unmeasured); the module boundary contains a later swap.
**Done:** [ ]

### Task 5: Read-only check (snapshot and compare)
**What:** Implement a reusable library that snapshots a directory tree (relative path, type, size, mode, content hash, mtime, ctime, birthtime, atime, xattr names and value hashes) and compares two snapshots, with access time reported separately.
**Files:** tools/readonly-check/snapshot.js, tools/readonly-check/compare.js, tools/readonly-check/index.js
**Done when:** `node -e "const c=require('./tools/readonly-check');const a=c.snapshot('src');const b=c.snapshot('src');console.log(Object.keys(c.compare(a,b)))"` runs without error and exits 0, and the module exports snapshot, compare and an assert function that throws on any non-atime difference; full behavioural verification is Task 6.
**Depends on:** 1
**Estimate:** 5
**Notes:** Covers FR-14, FR-15. Ordering rule: the before-snapshot records atime after its content hashing; the after-snapshot records atime before its content hashing. The atime-fails flag defaults to never-fail while always reporting. Placed under tools/ so any feature's tests can import it.
**Done:** [ ]

### Task 6: Read-only check tests
**What:** Write the tests showing the check detects each required change and reports no differences for two untouched snapshots.
**Files:** tests/unit/readonly-check.test.js
**Done when:** `npx vitest run tests/unit/readonly-check.test.js` exits 0, with one test each for: byte changed, file created, file deleted, file renamed, mtime changed, xattr added, xattr value changed, xattr removed (each naming the differing field), plus a test that two snapshots with nothing in between report no differences including access time, and a test that an atime-only difference is reported separately and does not fail by default but does fail with the flag set.
**Depends on:** 2, 5
**Estimate:** 3
**Notes:** Covers FR-16 and the FR-15 flag behaviour.
**Done:** [ ]

### Task 7: Access-time measurement (FR-21)
**What:** Add a measurement script that reads a fixture file with plain `cat`, compares access time before and after on each volume type, and writes the recorded result to a file.
**Files:** tools/atime-measurement/measure.js, docs/measurements/atime-cat-read.md
**Done when:** `node tools/atime-measurement/measure.js <volume-path> --label <internal-apfs|external|network>` exits 0 and appends a record (label, path, filesystem type, atime before, atime after, whether they differ) to `docs/measurements/atime-cat-read.md`, and the file holds a record for each of the three volume types or explicitly states which volume type was not available to measure.
**Depends on:** 1
**Estimate:** 2
**Notes:** Covers FR-21. This is a measurement task, not product code. The result file records only what was measured; it must not state a cause for any observed atime behaviour. Until the file has results, FR-15's default stays never-fail. External and network volumes need the user's hardware, so those records may need to be run outside the sandbox by the user.
**Done:** [ ]

### Task 8: Discovery
**What:** Implement the discovery function that walks a folder at any depth and returns index records for supported files, skipping dot-names, package bundles and symlinks.
**Files:** src/main/discovery/discover.js, src/main/discovery/packages.js, tests/unit/discovery.test.js
**Done when:** `npx vitest run tests/unit/discovery.test.js` exits 0 against the Task 2 fixture tree, asserting: supported files at depth 4 are indexed, extension matching is case-insensitive (e.g. `A.JPG`), unsupported extensions are not indexed, dot-files and dot-folders (and contents) are skipped, package contents (`.app`, `.photoslibrary`, `.bundle`, `.framework`, `.rtfd`) are not indexed, a symlink to a folder is not followed, a symlink to a file is not indexed, and the package extension list lives in one named place.
**Depends on:** 2, 3
**Estimate:** 5
**Notes:** Covers FR-5, FR-6, FR-7, FR-8. Discovery must only read; it creates nothing in the scanned folders.
**Done:** [ ]

### Task 9: Run discovery off the rendering path
**What:** Run discovery in a worker (worker thread or utility process) so the window stays interactive during a scan, with results delivered when the scan completes.
**Files:** src/main/discovery/worker.js, src/main/discovery/run-scan.js, tests/unit/run-scan.test.js
**Done when:** `npx vitest run tests/unit/run-scan.test.js` exits 0, asserting the scan runs in a separate thread or process (its thread/process id differs from the main one), that its result equals Task 8's direct output on the fixture tree, and that the main event loop keeps servicing a timer during a scan of a large generated tree.
**Depends on:** 8
**Estimate:** 3
**Notes:** Covers FR-12. Incremental publishing and progress are Feature 5; only completion-time results are required here.
**Done:** [ ]

### Task 10: Tree model
**What:** Implement the pure function that turns index records into the folder tree: root folders always present (even when empty or unavailable), every folder below the roots only if it contains at least one supported file at any depth, subfolders before files, case-insensitive natural numeric sort.
**Files:** src/shared/tree-model.js, tests/unit/tree-model.test.js
**Done when:** `npx vitest run tests/unit/tree-model.test.js` exits 0, asserting IMG_2 sorts before IMG_10, folders precede files at each level, case differences do not affect order, non-root folders with no supported file at any depth are absent, a root folder with no files or marked unavailable is still present, and nodes expose an `unavailable` flag passed through from the folder record.
**Depends on:** 4
**Estimate:** 2
**Notes:** Covers FR-11 (structure and order). Input record shape is defined by the storage module (Task 4).
**Done:** [ ]

### Task 11: Collection service
**What:** Implement main-process logic to create a named collection from one or more directories, scan them, persist everything through storage, and on launch load stored collections and mark inaccessible folders unavailable without dropping records or files.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js` exits 0, asserting: an empty name is rejected; a path that is a file is rejected; create then re-instantiate on the same storage returns the collection, folders and index without any picker or re-selection call; a folder removed from disk after creation is marked unavailable on load, its records and indexed files remain, and its files are flagged unavailable; the storage location is not inside any collection folder.
**Depends on:** 4, 9
**Estimate:** 3
**Notes:** Covers FR-1 (logic; directories only), FR-2, FR-3, FR-4, FR-13. No code path in this module writes inside a collection folder.
**Done:** [ ]

### Task 12: Rescan service and launch behaviour
**What:** Add the per-collection rescan operation that re-runs discovery over available folders and updates the index, and ensure launch shows the stored index without scanning.
**Files:** src/main/collections/rescan.js, tests/unit/rescan.test.js
**Done when:** `npx vitest run tests/unit/rescan.test.js` exits 0, asserting: a file added to a fixture folder appears after rescan and a deleted one disappears; unavailable folders are skipped and keep their stored files; loading collections on startup performs no discovery call.
**Depends on:** 11
**Estimate:** 2
**Notes:** Covers FR-20 (logic).
**Done:** [ ]

### Task 13: Create-collection UI with folder picker
**What:** Add the renderer UI and IPC to name a collection and choose directories only through the folder picker, with no way to add an individual file.
**Files:** src/main/ipc.js, src/main/preload.js, src/renderer/create-collection.js, tests/e2e/create-collection.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/create-collection.spec.js` exits 0; the test stubs the dialog result, creates a collection from two fixture folders and asserts the collection appears, and asserts the dialog is opened with directory-only properties (no file selection) and that an empty name is refused.
**Depends on:** 1, 11
**Estimate:** 2
**Notes:** Covers FR-1 (interface).
**Done:** [ ]

### Task 14: Virtualized folder tree view
**What:** Render a collection as the tree from Task 10 with virtualization so only visible or expanded nodes are in the DOM, always show root folders (including empty or unavailable ones), and mark files of unavailable folders "unavailable" instead of hiding them.
**Files:** src/renderer/tree-view.js, src/renderer/styles.css, tests/e2e/tree-view.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/tree-view.spec.js` exits 0, asserting: the fixture collection tree mirrors disk structure with names, a generated large index (e.g. 50,000 files) renders a DOM node count that stays under a fixed bound unrelated to index size, a collection with an unavailable folder shows its files marked "unavailable", and an unavailable or empty root folder is still shown (unavailable ones marked "unavailable").
**Depends on:** 10, 13
**Estimate:** 5
**Notes:** Covers FR-11 (render), FR-4 (display).
**Done:** [ ]

### Task 15: Rescan action in the UI
**What:** Add a user-triggered rescan button per collection and wire it to the rescan service.
**Files:** src/renderer/rescan-button.js, src/main/ipc.js, tests/e2e/rescan.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/rescan.spec.js` exits 0, asserting that adding a file to a fixture folder does not change the tree until Rescan is clicked and appears after it, and that relaunching shows the stored tree without a scan.
**Depends on:** 12, 14
**Estimate:** 2
**Notes:** Covers FR-20 (interface).
**Done:** [ ]

### Task 16: End-to-end full flow under the read-only check
**What:** Run the full flow (create collection, scan, browse tree, quit, relaunch) on the fixture tree with the read-only check snapshotting before and after, and assert no differences.
**Files:** tests/e2e/full-flow.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/full-flow.spec.js` exits 0: the test snapshots the fixture tree, drives the app through creation, browse, quit and relaunch (the collection and tree reappear with no folder picker), snapshots again, and the check reports no non-atime differences; the atime report is attached to the test output.
**Depends on:** 5, 6, 14, 15
**Estimate:** 5
**Notes:** Covers FR-17, FR-13, FR-3 (end-to-end relaunch without re-selection). Uses the Task 2 fixture tree including xattr files, symlinks and the package bundle.
**Done:** [ ]

### Task 17: Remove duplicated scan and readability helpers
**What:** Export `isReadableDirectory` and the default scan once and import them in rescan.js and service.js, and remove the unused async `discover` walk from discover.js, keeping `discoverSync`.
**Files:** src/main/discovery/discover.js, src/main/collections/rescan.js, src/main/collections/service.js, tests/unit/discovery.test.js
**Done when:** `npx vitest run` exits 0 for the whole unit suite, and a test asserts the module exports of discover.js do not include the async `discover` while `discoverSync` is still exported; `defaultScan` and `isReadableDirectory` are each defined in exactly one file (checked by `grep -rn "function defaultScan\|function isReadableDirectory" src` returning one line each); tests in discovery.test.js that only covered the removed function are switched to `discoverSync` or deleted, with the behaviours listed in Task 8 still asserted.
**Depends on:** 8, 12
**Estimate:** 2
**Notes:** Review finding 26 (rescan.js:30, service.js:85, discover.js). Covers FR-4, FR-5. Refactor with no behaviour change; the export test is the only one that fails before the change. Runs first of the fix tasks because 18, 19 and 25 edit the same files.
**Done:** [ ]

### Task 18: Fix storage-location guard for children named `..*`
**What:** Change `contains()` so only a relative path equal to `..` or starting with `..` plus the path separator (or an absolute relative result) counts as outside; a child named `..appdata` is inside.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js` exits 0, with a new test that a storage location at `<collection-folder>/..appdata` is rejected as inside the collection folder (the test fails on the pre-fix code, where `contains()` returns false for it), and tests that a sibling and a parent path are still classified correctly.
**Depends on:** 17
**Estimate:** 1
**Notes:** Review finding 17 (service.js:82). Covers FR-13. Depends on 17 only to avoid concurrent edits of service.js.
**Done:** [ ]

### Task 19: Re-read folder state after a successful rescan before clearing unavailable
**What:** In rescan, decide whether to clear a folder's unavailable flag from the folder state re-read from storage after the scan succeeds, not from the snapshot taken before the await.
**Files:** src/main/collections/rescan.js, tests/unit/rescan.test.js
**Done when:** `npx vitest run tests/unit/rescan.test.js` exits 0, with a new test where the stored folder state changes during an awaited scan (for example the folder is marked unavailable by another operation) and the final stored flag reflects the re-read state rather than the pre-await snapshot, plus a test that a folder that was unavailable and scans successfully is cleared (the first test fails on the pre-fix code).
**Depends on:** 17
**Estimate:** 2
**Notes:** Review finding 22 (rescan.js:67). Covers FR-4, FR-20. Depends on 17 because both edit rescan.js.
**Done:** [ ]

### Task 20: Keep Rescan disabled while a rescan runs, and reject concurrent rescans in main
**What:** Track per-collection in-flight rescan state in the renderer so `collection-selected` does not re-enable Rescan during a rescan, and make the main-process rescan reject (or ignore, with a defined result) a second rescan of the same collection while one is running.
**Files:** src/renderer/rescan-button.js, src/main/collections/rescan.js, src/main/ipc.js, tests/unit/rescan.test.js, tests/e2e/rescan.spec.js
**Done when:** `npx vitest run tests/unit/rescan.test.js` exits 0 with a new test that a second rescan of the same collection started while the first is pending returns the defined rejected result and runs discovery once, while a rescan of a different collection is not blocked; and `npm run test:e2e -- tests/e2e/rescan.spec.js` exits 0 with a new test that, with a slow stubbed rescan, selecting another collection and back leaves Rescan disabled until the rescan finishes (both new tests fail on the pre-fix code).
**Depends on:** 19, 15
**Estimate:** 2
**Notes:** Review finding 20 (rescan-button.js:17). Covers FR-20. Depends on 19 because both edit rescan.js.
**Done:** [ ]

### Task 21: Report a corrupt or newer-format store at startup without touching it
**What:** Wrap storage opening at app startup so a corrupt or newer-`FORMAT_VERSION` store.json is caught, an error is shown to the user (a message window or dialog naming the file), the app does not crash silently, and store.json is neither overwritten nor deleted.
**Files:** src/main/main.js, src/main/startup.js, tests/unit/startup.test.js
**Done when:** `npx vitest run tests/unit/startup.test.js` exits 0, with tests that (a) a store.json with invalid JSON and (b) one with a `FORMAT_VERSION` above the supported one each make the startup function call the injected error reporter with a message naming the file, resolve without throwing, and leave the store.json bytes identical to before (the tests fail on the pre-fix code, where the error is unhandled and no reporter exists); and a valid store opens with no error reported.
**Depends on:** 11
**Estimate:** 3
**Notes:** Review finding 18 (main.js:25). Covers FR-2, FR-18. The startup logic is extracted to src/main/startup.js with the dialog injected so it is unit-testable; the real dialog call in main.js is not covered by a test here.
**Done:** [ ]

### Task 22: Disable Create while a collection is being created
**What:** Disable the Create control for the duration of the `createCollection` call and re-enable it on completion or failure, so repeated clicks cannot create duplicates.
**Files:** src/renderer/create-collection.js, tests/e2e/create-collection.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/create-collection.spec.js` exits 0, with a new test that stubs `createCollection` to resolve slowly, double-clicks Create, and asserts the button is disabled during the call, exactly one collection exists afterwards, and the button is enabled again (fails on the pre-fix code, which creates two).
**Depends on:** 13
**Estimate:** 1
**Notes:** Review finding 19 (create-collection.js:71). Covers FR-1. E2E is used because the behaviour is renderer-only.
**Done:** [ ]

### Task 23: Discard stale collection-view responses
**What:** Give each `selectCollection` call a request token and apply a `getCollectionView` response only if it is still the latest request, so the displayed tree always matches the highlighted collection.
**Files:** src/renderer/create-collection.js, tests/e2e/tree-view.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/tree-view.spec.js` exits 0, with a new test that stubs `getCollectionView` so collection A's response resolves after B's, clicks A then B (and B then A), and asserts the tree shown is that of the last-clicked collection (fails on the pre-fix code, where the late response overwrites the tree).
**Depends on:** 22, 14
**Estimate:** 2
**Notes:** Review finding 21 (create-collection.js:48). Covers FR-11. Depends on 22 because both edit create-collection.js. E2E is used because the behaviour is renderer-only.
**Done:** [ ]

### Task 24: Give tree nodes an identity unique per root
**What:** Make every tree node's identity unique per root (for example root id plus relative path) and use it for expansion state, the `data-path` attribute and row keys, so root `/a/b` and subfolder `/a/b` under root `/a` do not collide; overlapping roots are not rejected.
**Files:** src/shared/tree-model.js, src/renderer/tree-view.js, tests/unit/tree-model.test.js, tests/e2e/tree-view.spec.js
**Done when:** `npx vitest run tests/unit/tree-model.test.js` exits 0 with a new test that a collection with roots `/a` and `/a/b` yields node ids that are all distinct, including the two nodes for `/a/b`; and `npm run test:e2e -- tests/e2e/tree-view.spec.js` exits 0 with a new test on that collection that expanding one of the two `/a/b` nodes does not expand the other and both rows render with distinct `data-path` values (both fail on the pre-fix code).
**Depends on:** 14, 23
**Estimate:** 3
**Notes:** Review finding 23 (service.js:114 accepts `/a` and `/a/b`). Product decision (Feature 3, product FR-5, OQ-6 resolved): overlapping folders are allowed and both are kept; files under the overlap are indexed twice until Feature 3 is accepted. So this task does not reject overlaps and adds no validation. Covers FR-11. Depends on 23 only to sequence renderer edits.
**Done:** [ ]

### Task 25: Summary-only collection list and per-folder index lookups
**What:** Make `collections:list` return summaries only (name, id, folder count, per-folder unavailable flag) with no file records and no deep copy of the index, and make the collection view read the index per folder through `getIndex({folderId})` instead of walking the whole index per collection.
**Files:** src/main/storage/index.js, src/main/collections/service.js, src/main/ipc.js, src/renderer/create-collection.js, tests/unit/storage.test.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/storage.test.js tests/unit/collection-service.test.js` exits 0, with tests that (a) the list payload for a collection with indexed files contains no file records at any depth (asserted by walking the payload) while still carrying name, id, folder count and per-folder unavailable, (b) `getIndex({folderId})` returns only that folder's records, and (c) the view for a collection with several folders returns the same tree input as before from per-folder lookups (the list test fails on the pre-fix code); and `npm run test:e2e -- tests/e2e/create-collection.spec.js` still exits 0.
**Depends on:** 18, 20, 23, 17
**Estimate:** 3
**Notes:** Review finding 24 (service.js:102). Covers FR-2, FR-12. Makes no performance claim; the verifiable outcome is the payload content. Depends on 17 and 18 (service.js), 20 (ipc.js) and 23 (create-collection.js) to avoid concurrent edits.
**Done:** [ ]

### Task 26: Batch storage mutations into one atomic write per operation
**What:** Add a transaction/commit API to the storage module so the mutations of one operation are applied in memory and persisted in a single write, keeping the atomic write-then-rename; use it in `createCollection` and rescan.
**Files:** src/main/storage/index.js, src/main/collections/service.js, src/main/collections/rescan.js, tests/unit/storage.test.js, tests/unit/collection-service.test.js, tests/unit/rescan.test.js
**Done when:** `npx vitest run tests/unit/storage.test.js tests/unit/collection-service.test.js tests/unit/rescan.test.js` exits 0, with tests that count writes of the store file (spy on the write-then-rename step) and assert exactly 1 for `createCollection` with N folders (for N = 1 and N = 3) and exactly 1 for a rescan, that a transaction that throws before commit writes nothing and leaves the stored file unchanged, and that the write still goes through a temp file then rename (the count tests fail on the pre-fix code, which writes 1+2N times for creation).
**Depends on:** 25, 19, 21
**Estimate:** 3
**Notes:** Review finding 25 (storage/index.js:130). Covers FR-18. The only claim is the write count; no performance claim is made. Depends on 25 (storage and service.js) and 19 (rescan.js) to avoid concurrent edits; 21 is listed so startup error handling lands before storage behaviour changes.
**Done:** [ ]

## Summary
- Total tasks: 26
- Total estimated effort: 71 points
- Critical path: 1 → 3 → 8 → 9 → 11 → 13 → 14 → 15 → 16 (tasks 1-16); review-fix chain after 15: 17 → 19 → 20 → 25 → 26
- Risks: Task 1 (Electron binary download may fail in the sandbox; Playwright's Electron support with Electron 44 is unverified and blocks every e2e task, 13 to 16); Task 7 (external and network volumes need the user's hardware); Task 4 (JSON store scale is unmeasured); Task 14 (virtualized rendering bound is chosen by the implementer); Task 5 (ctime/birthtime/atime ordering is subtle); Tasks 17-26 are review fixes sequenced by shared files (17 first; the rest follow in dependency order; each task cites its review finding number, which differs from the task number).

## Open Questions
None.
