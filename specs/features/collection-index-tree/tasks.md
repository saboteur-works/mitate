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
**Done:** [x]

### Task 2: Fixture tree builder
**What:** Provide a script that builds the FR-17 fixture tree in a temp directory (four-plus nested levels, supported and unsupported files, hidden file and folder, package bundle, symlink to a folder, symlink to a file, files with extended attributes).
**Files:** tests/support/fixture-tree.js, tests/unit/fixture-tree.test.js
**Done when:** `npx vitest run tests/unit/fixture-tree.test.js` exits 0, with assertions that each listed element exists in the built tree (depth of at least 4, a dot-file and dot-folder, a `.app` directory, both symlink kinds, at least one file with an xattr read back).
**Depends on:** 1
**Estimate:** 2
**Notes:** Covers the fixture part of FR-17; reused by Tasks 6, 8 and 16. Uses `xattr` via child process on macOS.
**Done:** [x]

### Task 3: Supported-type registry
**What:** Implement the registry module with one data table, lookup from extension to entry and listing by kind, containing exactly the FR-10 table.
**Files:** src/main/registry/types.js, tests/unit/registry.test.js
**Done when:** `npx vitest run tests/unit/registry.test.js` exits 0, asserting the exact set of registered extensions from FR-10, no duplicate extension, each entry has exactly one kind, RAW entries are kind image with subtype RAW, and jxl, caf, ac3, ts, mts, m2ts are absent.
**Depends on:** 1
**Estimate:** 2
**Notes:** Covers FR-9, FR-10. Lookup is on lowercase extension; case-insensitive matching of file names is applied by the caller (Task 8) or by a helper here.
**Done:** [x]

### Task 4: Storage module
**What:** Implement the single storage module (JSON file store) for collection records, folder records with absolute paths, the file index and folder-access data, with a storage location configurable in one place.
**Files:** src/main/storage/index.js, tests/unit/storage.test.js
**Done when:** `npx vitest run tests/unit/storage.test.js` exits 0, covering: write then reopen (new instance on the same path) returns the same collections, folders and index; location is set only through one config entry; default location resolves outside any given collection folder; no other module needs to read the store file (the module exposes only an API).
**Depends on:** 1
**Estimate:** 3
**Notes:** Covers FR-2 (persistence at the storage level), FR-3 (folder-access data goes through this module), FR-18, FR-13 (storage outside collection folders). Known risk: a JSON store is not expected to scale to hundreds of thousands of files (unmeasured); the module boundary contains a later swap.
**Done:** [x]

### Task 5: Read-only check (snapshot and compare)
**What:** Implement a reusable library that snapshots a directory tree (relative path, type, size, mode, content hash, mtime, ctime, birthtime, atime, xattr names and value hashes) and compares two snapshots, with access time reported separately.
**Files:** tools/readonly-check/snapshot.js, tools/readonly-check/compare.js, tools/readonly-check/index.js
**Done when:** `node -e "const c=require('./tools/readonly-check');const a=c.snapshot('src');const b=c.snapshot('src');console.log(Object.keys(c.compare(a,b)))"` runs without error and exits 0, and the module exports snapshot, compare and an assert function that throws on any non-atime difference; full behavioural verification is Task 6.
**Depends on:** 1
**Estimate:** 5
**Notes:** Covers FR-14, FR-15. Ordering rule: the before-snapshot records atime after its content hashing; the after-snapshot records atime before its content hashing. The atime-fails flag defaults to never-fail while always reporting. Placed under tools/ so any feature's tests can import it.
**Done:** [x]

### Task 6: Read-only check tests
**What:** Write the tests showing the check detects each required change and reports no differences for two untouched snapshots.
**Files:** tests/unit/readonly-check.test.js
**Done when:** `npx vitest run tests/unit/readonly-check.test.js` exits 0, with one test each for: byte changed, file created, file deleted, file renamed, mtime changed, xattr added, xattr value changed, xattr removed (each naming the differing field), plus a test that two snapshots with nothing in between report no differences including access time, and a test that an atime-only difference is reported separately and does not fail by default but does fail with the flag set.
**Depends on:** 2, 5
**Estimate:** 3
**Notes:** Covers FR-16 and the FR-15 flag behaviour.
**Done:** [x]

### Task 7: Access-time measurement (FR-21)
**What:** Add a measurement script that reads a fixture file with plain `cat`, compares access time before and after on each volume type, and writes the recorded result to a file.
**Files:** tools/atime-measurement/measure.js, docs/measurements/atime-cat-read.md
**Done when:** `node tools/atime-measurement/measure.js <volume-path> --label <internal-apfs|external|network>` exits 0 and appends a record (label, path, filesystem type, atime before, atime after, whether they differ) to `docs/measurements/atime-cat-read.md`, and the file holds a record for each of the three volume types or explicitly states which volume type was not available to measure.
**Depends on:** 1
**Estimate:** 2
**Notes:** Covers FR-21. This is a measurement task, not product code. The result file records only what was measured; it must not state a cause for any observed atime behaviour. Until the file has results, FR-15's default stays never-fail. External and network volumes need the user's hardware, so those records may need to be run outside the sandbox by the user.
**Done:** [x]

### Task 8: Discovery
**What:** Implement the discovery function that walks a folder at any depth and returns index records for supported files, skipping dot-names, package bundles and symlinks.
**Files:** src/main/discovery/discover.js, src/main/discovery/packages.js, tests/unit/discovery.test.js
**Done when:** `npx vitest run tests/unit/discovery.test.js` exits 0 against the Task 2 fixture tree, asserting: supported files at depth 4 are indexed, extension matching is case-insensitive (e.g. `A.JPG`), unsupported extensions are not indexed, dot-files and dot-folders (and contents) are skipped, package contents (`.app`, `.photoslibrary`, `.bundle`, `.framework`, `.rtfd`) are not indexed, a symlink to a folder is not followed, a symlink to a file is not indexed, and the package extension list lives in one named place.
**Depends on:** 2, 3
**Estimate:** 5
**Notes:** Covers FR-5, FR-6, FR-7, FR-8. Discovery must only read; it creates nothing in the scanned folders.
**Done:** [x]

### Task 9: Run discovery off the rendering path
**What:** Run discovery in a worker (worker thread or utility process) so the window stays interactive during a scan, with results delivered when the scan completes.
**Files:** src/main/discovery/worker.js, src/main/discovery/run-scan.js, tests/unit/run-scan.test.js
**Done when:** `npx vitest run tests/unit/run-scan.test.js` exits 0, asserting the scan runs in a separate thread or process (its thread/process id differs from the main one), that its result equals Task 8's direct output on the fixture tree, and that the main event loop keeps servicing a timer during a scan of a large generated tree.
**Depends on:** 8
**Estimate:** 3
**Notes:** Covers FR-12. Incremental publishing and progress are Feature 5; only completion-time results are required here.
**Done:** [x]

### Task 10: Tree model
**What:** Implement the pure function that turns index records into the folder tree: root folders always present (even when empty or unavailable), every folder below the roots only if it contains at least one supported file at any depth, subfolders before files, case-insensitive natural numeric sort.
**Files:** src/shared/tree-model.js, tests/unit/tree-model.test.js
**Done when:** `npx vitest run tests/unit/tree-model.test.js` exits 0, asserting IMG_2 sorts before IMG_10, folders precede files at each level, case differences do not affect order, non-root folders with no supported file at any depth are absent, a root folder with no files or marked unavailable is still present, and nodes expose an `unavailable` flag passed through from the folder record.
**Depends on:** 4
**Estimate:** 2
**Notes:** Covers FR-11 (structure and order). Input record shape is defined by the storage module (Task 4).
**Done:** [x]

### Task 11: Collection service
**What:** Implement main-process logic to create a named collection from one or more directories, scan them, persist everything through storage, and on launch load stored collections and mark inaccessible folders unavailable without dropping records or files.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js` exits 0, asserting: an empty name is rejected; a path that is a file is rejected; create then re-instantiate on the same storage returns the collection, folders and index without any picker or re-selection call; a folder removed from disk after creation is marked unavailable on load, its records and indexed files remain, and its files are flagged unavailable; the storage location is not inside any collection folder.
**Depends on:** 4, 9
**Estimate:** 3
**Notes:** Covers FR-1 (logic; directories only), FR-2, FR-3, FR-4, FR-13. No code path in this module writes inside a collection folder.
**Done:** [x]

### Task 12: Rescan service and launch behaviour
**What:** Add the per-collection rescan operation that re-runs discovery over available folders and updates the index, and ensure launch shows the stored index without scanning.
**Files:** src/main/collections/rescan.js, tests/unit/rescan.test.js
**Done when:** `npx vitest run tests/unit/rescan.test.js` exits 0, asserting: a file added to a fixture folder appears after rescan and a deleted one disappears; unavailable folders are skipped and keep their stored files; loading collections on startup performs no discovery call.
**Depends on:** 11
**Estimate:** 2
**Notes:** Covers FR-20 (logic).
**Done:** [x]

### Task 13: Create-collection UI with folder picker
**What:** Add the renderer UI and IPC to name a collection and choose directories only through the folder picker, with no way to add an individual file.
**Files:** src/main/ipc.js, src/main/preload.js, src/renderer/create-collection.js, tests/e2e/create-collection.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/create-collection.spec.js` exits 0; the test stubs the dialog result, creates a collection from two fixture folders and asserts the collection appears, and asserts the dialog is opened with directory-only properties (no file selection) and that an empty name is refused.
**Depends on:** 1, 11
**Estimate:** 2
**Notes:** Covers FR-1 (interface).
**Done:** [x]

### Task 14: Virtualized folder tree view
**What:** Render a collection as the tree from Task 10 with virtualization so only visible or expanded nodes are in the DOM, always show root folders (including empty or unavailable ones), and mark files of unavailable folders "unavailable" instead of hiding them.
**Files:** src/renderer/tree-view.js, src/renderer/styles.css, tests/e2e/tree-view.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/tree-view.spec.js` exits 0, asserting: the fixture collection tree mirrors disk structure with names, a generated large index (e.g. 50,000 files) renders a DOM node count that stays under a fixed bound unrelated to index size, a collection with an unavailable folder shows its files marked "unavailable", and an unavailable or empty root folder is still shown (unavailable ones marked "unavailable").
**Depends on:** 10, 13
**Estimate:** 5
**Notes:** Covers FR-11 (render), FR-4 (display).
**Done:** [x]

### Task 15: Rescan action in the UI
**What:** Add a user-triggered rescan button per collection and wire it to the rescan service.
**Files:** src/renderer/rescan-button.js, src/main/ipc.js, tests/e2e/rescan.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/rescan.spec.js` exits 0, asserting that adding a file to a fixture folder does not change the tree until Rescan is clicked and appears after it, and that relaunching shows the stored tree without a scan.
**Depends on:** 12, 14
**Estimate:** 2
**Notes:** Covers FR-20 (interface).
**Done:** [x]

### Task 16: End-to-end full flow under the read-only check
**What:** Run the full flow (create collection, scan, browse tree, quit, relaunch) on the fixture tree with the read-only check snapshotting before and after, and assert no differences.
**Files:** tests/e2e/full-flow.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/full-flow.spec.js` exits 0: the test snapshots the fixture tree, drives the app through creation, browse, quit and relaunch (the collection and tree reappear with no folder picker), snapshots again, and the check reports no non-atime differences; the atime report is attached to the test output.
**Depends on:** 5, 6, 14, 15
**Estimate:** 5
**Notes:** Covers FR-17, FR-13, FR-3 (end-to-end relaunch without re-selection). Uses the Task 2 fixture tree including xattr files, symlinks and the package bundle.
**Done:** [x]

### Task 17: Remove duplicated scan and readability helpers
**What:** Export `isReadableDirectory` and the default scan once and import them in rescan.js and service.js, and remove the unused async `discover` walk from discover.js, keeping `discoverSync`.
**Files:** src/main/discovery/discover.js, src/main/collections/rescan.js, src/main/collections/service.js, tests/unit/discovery.test.js
**Done when:** `npx vitest run` exits 0 for the whole unit suite, and a test asserts the module exports of discover.js do not include the async `discover` while `discoverSync` is still exported; `defaultScan` and `isReadableDirectory` are each defined in exactly one file (checked by `grep -rn "function defaultScan\|function isReadableDirectory" src` returning one line each); tests in discovery.test.js that only covered the removed function are switched to `discoverSync` or deleted, with the behaviours listed in Task 8 still asserted.
**Depends on:** 8, 12
**Estimate:** 2
**Notes:** Review finding 26 (rescan.js:30, service.js:85, discover.js). Covers FR-4, FR-5. Refactor with no behaviour change; the export test is the only one that fails before the change. Runs first of the fix tasks because 18, 19 and 25 edit the same files.
**Done:** [x]

### Task 18: Fix storage-location guard for children named `..*`
**What:** Change `contains()` so only a relative path equal to `..` or starting with `..` plus the path separator (or an absolute relative result) counts as outside; a child named `..appdata` is inside.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js` exits 0, with a new test that a storage location at `<collection-folder>/..appdata` is rejected as inside the collection folder (the test fails on the pre-fix code, where `contains()` returns false for it), and tests that a sibling and a parent path are still classified correctly.
**Depends on:** 17
**Estimate:** 1
**Notes:** Review finding 17 (service.js:82). Covers FR-13. Depends on 17 only to avoid concurrent edits of service.js.
**Done:** [x]

### Task 19: Re-read folder state after a successful rescan before clearing unavailable
**What:** In rescan, decide whether to clear a folder's unavailable flag from the folder state re-read from storage after the scan succeeds, not from the snapshot taken before the await.
**Files:** src/main/collections/rescan.js, tests/unit/rescan.test.js
**Done when:** `npx vitest run tests/unit/rescan.test.js` exits 0, with a new test where the stored folder state changes during an awaited scan (for example the folder is marked unavailable by another operation) and the final stored flag reflects the re-read state rather than the pre-await snapshot, plus a test that a folder that was unavailable and scans successfully is cleared (the first test fails on the pre-fix code).
**Depends on:** 17
**Estimate:** 2
**Notes:** Review finding 22 (rescan.js:67). Covers FR-4, FR-20. Depends on 17 because both edit rescan.js.
**Done:** [x]

### Task 20: Keep Rescan disabled while a rescan runs, and reject concurrent rescans in main
**What:** Track per-collection in-flight rescan state in the renderer so `collection-selected` does not re-enable Rescan during a rescan, and make the main-process rescan reject (or ignore, with a defined result) a second rescan of the same collection while one is running.
**Files:** src/renderer/rescan-button.js, src/main/collections/rescan.js, src/main/ipc.js, tests/unit/rescan.test.js, tests/e2e/rescan.spec.js
**Done when:** `npx vitest run tests/unit/rescan.test.js` exits 0 with a new test that a second rescan of the same collection started while the first is pending returns the defined rejected result and runs discovery once, while a rescan of a different collection is not blocked; and `npm run test:e2e -- tests/e2e/rescan.spec.js` exits 0 with a new test that, with a slow stubbed rescan, selecting another collection and back leaves Rescan disabled until the rescan finishes (both new tests fail on the pre-fix code).
**Depends on:** 19, 15
**Estimate:** 2
**Notes:** Review finding 20 (rescan-button.js:17). Covers FR-20. Depends on 19 because both edit rescan.js.
**Done:** [x]

### Task 21: Report a corrupt or newer-format store at startup without touching it
**What:** Wrap storage opening at app startup so a corrupt or newer-`FORMAT_VERSION` store.json is caught, an error is shown to the user (a message window or dialog naming the file), the app does not crash silently, and store.json is neither overwritten nor deleted.
**Files:** src/main/main.js, src/main/startup.js, tests/unit/startup.test.js
**Done when:** `npx vitest run tests/unit/startup.test.js` exits 0, with tests that (a) a store.json with invalid JSON and (b) one with a `FORMAT_VERSION` above the supported one each make the startup function call the injected error reporter with a message naming the file, resolve without throwing, and leave the store.json bytes identical to before (the tests fail on the pre-fix code, where the error is unhandled and no reporter exists); and a valid store opens with no error reported.
**Depends on:** 11
**Estimate:** 3
**Notes:** Review finding 18 (main.js:25). Covers FR-2, FR-18. The startup logic is extracted to src/main/startup.js with the dialog injected so it is unit-testable; the real dialog call in main.js is not covered by a test here.
**Done:** [x]

### Task 22: Disable Create while a collection is being created
**What:** Disable the Create control for the duration of the `createCollection` call and re-enable it on completion or failure, so repeated clicks cannot create duplicates.
**Files:** src/renderer/create-collection.js, tests/e2e/create-collection.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/create-collection.spec.js` exits 0, with a new test that stubs `createCollection` to resolve slowly, double-clicks Create, and asserts the button is disabled during the call, exactly one collection exists afterwards, and the button is enabled again (fails on the pre-fix code, which creates two).
**Depends on:** 13
**Estimate:** 1
**Notes:** Review finding 19 (create-collection.js:71). Covers FR-1. E2E is used because the behaviour is renderer-only.
**Done:** [x]

### Task 23: Discard stale collection-view responses
**What:** Give each `selectCollection` call a request token and apply a `getCollectionView` response only if it is still the latest request, so the displayed tree always matches the highlighted collection.
**Files:** src/renderer/create-collection.js, tests/e2e/tree-view.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/tree-view.spec.js` exits 0, with a new test that stubs `getCollectionView` so collection A's response resolves after B's, clicks A then B (and B then A), and asserts the tree shown is that of the last-clicked collection (fails on the pre-fix code, where the late response overwrites the tree).
**Depends on:** 22, 14
**Estimate:** 2
**Notes:** Review finding 21 (create-collection.js:48). Covers FR-11. Depends on 22 because both edit create-collection.js. E2E is used because the behaviour is renderer-only.
**Done:** [x]

### Task 24: Give tree nodes an identity unique per root
**What:** Make every tree node's identity unique per root (for example root id plus relative path) and use it for expansion state, the `data-path` attribute and row keys, so root `/a/b` and subfolder `/a/b` under root `/a` do not collide; overlapping roots are not rejected.
**Files:** src/shared/tree-model.js, src/renderer/tree-view.js, tests/unit/tree-model.test.js, tests/e2e/tree-view.spec.js
**Done when:** `npx vitest run tests/unit/tree-model.test.js` exits 0 with a new test that a collection with roots `/a` and `/a/b` yields node ids that are all distinct, including the two nodes for `/a/b`; and `npm run test:e2e -- tests/e2e/tree-view.spec.js` exits 0 with a new test on that collection that expanding one of the two `/a/b` nodes does not expand the other and both rows render with distinct `data-path` values (both fail on the pre-fix code).
**Depends on:** 14, 23
**Estimate:** 3
**Notes:** Review finding 23 (service.js:114 accepts `/a` and `/a/b`). Product decision (Feature 3, product FR-5, OQ-6 resolved): overlapping folders are allowed and both are kept; files under the overlap are indexed twice until Feature 3 is accepted. So this task does not reject overlaps and adds no validation. Covers FR-11. Depends on 23 only to sequence renderer edits.
**Done:** [x]

### Task 25: Summary-only collection list and per-folder index lookups
**What:** Make `collections:list` return summaries only (name, id, folder count, per-folder unavailable flag) with no file records and no deep copy of the index, and make the collection view read the index per folder through `getIndex({folderId})` instead of walking the whole index per collection.
**Files:** src/main/storage/index.js, src/main/collections/service.js, src/main/ipc.js, src/renderer/create-collection.js, tests/unit/storage.test.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/storage.test.js tests/unit/collection-service.test.js` exits 0, with tests that (a) the list payload for a collection with indexed files contains no file records at any depth (asserted by walking the payload) while still carrying name, id, folder count and per-folder unavailable, (b) `getIndex({folderId})` returns only that folder's records, and (c) the view for a collection with several folders returns the same tree input as before from per-folder lookups (the list test fails on the pre-fix code); and `npm run test:e2e -- tests/e2e/create-collection.spec.js` still exits 0.
**Depends on:** 18, 20, 23, 17
**Estimate:** 3
**Notes:** Review finding 24 (service.js:102). Covers FR-2, FR-12. Makes no performance claim; the verifiable outcome is the payload content. Depends on 17 and 18 (service.js), 20 (ipc.js) and 23 (create-collection.js) to avoid concurrent edits.
**Done:** [x]

### Task 26: Batch storage mutations into one atomic write per operation
**What:** Add a transaction/commit API to the storage module so the mutations of one operation are applied in memory and persisted in a single write, keeping the atomic write-then-rename; use it in `createCollection` and rescan.
**Files:** src/main/storage/index.js, src/main/collections/service.js, src/main/collections/rescan.js, tests/unit/storage.test.js, tests/unit/collection-service.test.js, tests/unit/rescan.test.js
**Done when:** `npx vitest run tests/unit/storage.test.js tests/unit/collection-service.test.js tests/unit/rescan.test.js` exits 0, with tests that count writes of the store file (spy on the write-then-rename step) and assert exactly 1 for `createCollection` with N folders (for N = 1 and N = 3) and exactly 1 for a rescan, that a transaction that throws before commit writes nothing and leaves the stored file unchanged, and that the write still goes through a temp file then rename (the count tests fail on the pre-fix code, which writes 1+2N times for creation).
**Depends on:** 25, 19, 21
**Estimate:** 3
**Notes:** Review finding 25 (storage/index.js:130). Covers FR-18. The only claim is the write count; no performance claim is made. Depends on 25 (storage and service.js) and 19 (rescan.js) to avoid concurrent edits; 21 is listed so startup error handling lands before storage behaviour changes.
**Done:** [x]

### Task 27: Correct the fixture's `supported` flag for notes.txt
**What:** Change `Photos/2024/Trip/Day1/notes.txt` in the fixture tree builder from unsupported to supported (txt is a registered document type), and remove the test code that works around the wrong flag.
**Files:** tests/support/fixture-tree.js, tests/unit/fixture-tree.test.js, tests/unit/discovery.test.js, tests/e2e/tree-view.spec.js
**Done when:** `npx vitest run` exits 0 for the whole unit suite and `npm run test:e2e -- tests/e2e/tree-view.spec.js` exits 0, with a test in fixture-tree.test.js asserting the fixture's own list of supported files includes `Photos/2024/Trip/Day1/notes.txt` (fails on the pre-fix code), `discovery.test.js` comparing discovery output to the fixture's supported list with no `expected.push('Photos/2024/Trip/Day1/notes.txt')` workaround, and `grep -rn "notes.txt" tests/unit/discovery.test.js` showing no special-casing comment or push.
**Depends on:** 26
**Estimate:** 1
**Notes:** Covers FR-10 (txt is registered) and the fixture part of FR-17. Any other test that adds notes.txt by hand (for example the comment at tests/e2e/tree-view.spec.js:151) is updated to read the flag from the fixture instead.
**Done:** [x]

### Task 28: Startup tests for an older-format store and an unreadable store
**What:** Add startup tests for store.json with an older `FORMAT_VERSION` and for a store.json that cannot be read because of permissions (mode 000), asserting the same behaviour as the corrupt and newer-format cases from Task 21: the error reporter is called with a message naming the file, startup resolves without throwing, and the file is unchanged.
**Files:** tests/unit/startup.test.js, and src/main/startup.js or src/main/storage/index.js only if the tests show the behaviour is missing
**Done when:** `npx vitest run tests/unit/startup.test.js` exits 0, with tests that (a) a store.json whose `FORMAT_VERSION` is below the supported one and (b) a store.json with mode 000 (restored to 0600 in teardown, and skipped with a stated reason when the process runs as root) each make startup call the injected error reporter with a message naming the file, resolve without throwing, and leave the store.json bytes and mode identical to before; if either test fails on the current code, the minimal fix is made in the same task and the failing output is recorded in the commit message.
**Depends on:** 21
**Estimate:** 2
**Notes:** Covers FR-2, FR-18. These are tests of cases Task 21 did not cover; whether they pass on the current code is unknown until they run, so this task does not assume a fix is needed. If an older format is meant to be migrated rather than reported, that is a product decision: record it as an Open Question rather than choosing here. Expected behaviour per the request is the same error report with the file unchanged.
**Done:** [x]

### Task 29: Tests with a real unreadable collection folder
**What:** Add tests that use a real fixture folder with mode 000 for create, load (startup) and rescan, asserting the folder is marked unavailable and nothing on disk changes, in place of stubbed unreadability.
**Files:** tests/unit/collection-service.test.js, tests/unit/rescan.test.js, tests/support/fixture-tree.js (only if a helper for locking and restoring a folder is added)
**Done when:** `npx vitest run tests/unit/collection-service.test.js tests/unit/rescan.test.js` exits 0, with tests that, for a collection folder chmod 000 on a copy of the fixture: (a) create marks the folder unavailable and records no files for it, (b) load on a re-instantiated service marks it unavailable and keeps its previously indexed files flagged unavailable, (c) rescan skips it, keeps its stored files and leaves it unavailable; each test takes a read-only-check snapshot of the other fixture folders before and after and asserts no non-atime differences, and restores permissions in `afterEach` so the temp directory can be removed; the tests are skipped with a stated reason when running as root.
**Depends on:** 27
**Estimate:** 3
**Notes:** Covers FR-4, FR-17, FR-20. The snapshot cannot descend into the locked folder, so the locked folder's own mode and parent entry are asserted unchanged by `fs.statSync` on the folder itself. Tests that stub readability remain; these add the real-permission case. Depends on 27 because both edit the fixture and its consumers.
**Done:** [x]

### Task 30: Remove unused variables flagged by the TypeScript checker
**What:** Remove the three unused variables: `id` at tests/unit/rescan.test.js:143, `require` at tests/unit/storage.test.js:7 and `e` at tests/unit/discovery.test.js:116.
**Files:** tests/unit/rescan.test.js, tests/unit/storage.test.js, tests/unit/discovery.test.js
**Done when:** `npx vitest run` exits 0 for the whole unit suite, and the TypeScript checker run that reported them no longer reports those three diagnostics (the command used is recorded in the commit message); removing `require` keeps storage.test.js working, so it is replaced by whatever the test actually uses.
**Depends on:** 27, 29
**Estimate:** 1
**Notes:** No behaviour change; there is no failing-before test. Line numbers are as reported and may have moved after Tasks 27 and 29, so the variables are located by name. Depends on 27 and 29 because they edit the same test files.
**Done:** [x]

### Task 31: Replace `ipcMain._invokeHandlers` in e2e tests with a supported mechanism
**What:** Stop the e2e tests reading the Electron-internal `ipcMain._invokeHandlers`. Expose the original handler through a supported, non-test-only seam in ipc.js (for example `registerIpc` returning, or the module exporting a lookup for, the handler it registered for each channel), and have the tests wrap it with `ipcMain.removeHandler(channel)` followed by `ipcMain.handle(channel, wrapper)` where the wrapper calls the captured original.
**Files:** src/main/ipc.js, tests/support/ipc-wrap.js, tests/e2e/create-collection.spec.js, tests/e2e/tree-view.spec.js, tests/unit/ipc.test.js
**Done when:** `grep -rn "_invokeHandlers" src tests` returns no matches, `npx vitest run tests/unit/ipc.test.js` exits 0 with a new test that the seam returns the registered handler for each channel in `CHANNELS` and that calling it gives the same result as invoking the channel (fails before the seam exists), and `npm run test:e2e -- tests/e2e/create-collection.spec.js tests/e2e/tree-view.spec.js` exits 0 with their existing delayed-response and stubbed-response tests unchanged in what they assert.
**Depends on:** 27
**Estimate:** 3
**Notes:** Covers FR-1, FR-11 (test mechanism only). The seam must have a product reason independent of the tests (a handler lookup by channel), carry no test-only branch, and be documented in the ipc.js header. If Playwright's `electronApp.evaluate` cannot reach the seam through `require` of the module, record the failure output and report it rather than falling back to an internal API. Depends on 27 because both edit tree-view.spec.js.
**Done:** [x]

### Task 32: Move the rescan-delay test hook out of main.js
**What:** Remove the `MEDIA_ORGANIZER_RESCAN_DELAY_MS` code from src/main/main.js and make the rescan e2e slow a rescan by wrapping the `collections:rescan` handler in the main process with the Task 31 mechanism (remove and re-register with a wrapper that waits before calling the original).
**Files:** src/main/main.js, tests/e2e/rescan.spec.js, tests/support/ipc-wrap.js
**Done when:** `grep -rn "RESCAN_DELAY" src tests` returns no matches, `grep -n "process.env" src/main/main.js` shows no test-only variable, and `npm run test:e2e -- tests/e2e/rescan.spec.js` exits 0 with the Task 20 test (selecting another collection and back leaves Rescan disabled until the slowed rescan finishes) still present and passing against the wrapper; a temporary mutation that re-enables the button on `collection-selected` makes that test fail, recorded in the commit message.
**Depends on:** 20, 31
**Estimate:** 2
**Notes:** Covers FR-20 (test mechanism only). No test-only code remains in product files. The wrapper delays only the e2e's launched app instance and is installed from the test through `electronApp.evaluate`.
**Done:** [x]

### Task 33: Measurement: JSON store cost at 50k, 200k and 500k file records
**What:** Add a measurement script that, for index sizes of 50,000, 200,000 and 500,000 file records, measures the storage module's load time, save time and one transaction (Task 26) commit time, and the size of store.json, with several runs per size, and records the results.
**Files:** tools/store-scale/measure.js, docs/measurements/json-store-scale.md
**Done when:** `node tools/store-scale/measure.js` exits 0 and writes `docs/measurements/json-store-scale.md` containing: machine (model, CPU, RAM, OS version), Node version and Electron version, the method (record shape, how the store was populated, whether the OS file cache was warm, number of runs), and for each of the three sizes the store.json size in bytes and the individual run values plus min, median and max in milliseconds for load, save and transaction commit; with at least 5 runs per size per operation.
**Depends on:** 26
**Estimate:** 3
**Notes:** Covers FR-18 (measurement; resolves the unmeasured risk named in Task 4). This is a measurement task, not product code. The document records only what was measured. It states no cause for any timing, and no conclusion such as "adequate" or "too slow". Each run uses a temporary storage location outside any collection folder, removed afterwards. Peak memory is recorded only if the script measures it.
**Done:** [x]

### Task 34: Measurement: scan wall time and peak RSS
**What:** Add a measurement script that runs discovery in the worker (Task 9) over (a) a generated tree of 200,000 files on the internal APFS volume and (b) a real directory tree that holds no user data and is read-only (for example `/System/Library`), and records wall time and peak resident set size for several runs of each.
**Files:** tools/scan-speed/measure.js, tools/scan-speed/generate-tree.js, docs/measurements/scan-speed.md
**Done when:** `node tools/scan-speed/measure.js` exits 0 and writes `docs/measurements/scan-speed.md` containing: machine (model, CPU, RAM, OS version), Node and Electron versions, the method (how the generated tree was shaped, how peak RSS was obtained, warm or cold cache, number of runs), and for each of (a) and (b) the number of files found, the individual wall time and peak RSS values and their min, median and max, with at least 5 runs each; the generated tree is created under the system temp directory on the internal APFS volume and removed afterwards, and the script writes nothing inside the real directory tree.
**Depends on:** 9
**Estimate:** 3
**Notes:** Covers FR-12 (measurement; input to the blocked product FR-20 targets, which this task does not set). This is a measurement task, not product code. Facts only: no cause, comparison to Finder or Bridge, or conclusion about adequacy. The /System/Library run is read-only and touches no user data; its file count is recorded because it may change across OS updates. If part of the tree is unreadable, the count of skipped directories is recorded.
**Done:** [x]

### Task 35: Describe each data-file startup failure by what went wrong
**What:** Make the startup error report for the data file say what actually went wrong for each case: invalid JSON, newer format, older format, unrecognized format, and permission denied.
**Files:** src/main/startup.js, src/main/storage/index.js, tests/unit/startup.test.js
**Done when:** `npx vitest run tests/unit/startup.test.js` exits 0 with 5 new assertions on the wording for the five cases, which failed against the old wording and now pass; the wording for 4 of the cases was also checked in the real app.
**Depends on:** 28
**Estimate:** 2
**Notes:** Commit 19ca421. Covers FR-2, FR-18. Recorded after the work was done. Verified as stated: 5 new assertions failed against the old wording and all pass; 4 cases checked in the real app.
**Done:** [x]

### Task 36: Run e2e tests in the background without stealing focus
**What:** Launch the e2e app instance without taking window focus from the user, through tests/support/background-main.js, with an opt-in `MO_E2E_VISIBLE=1` to show the window.
**Files:** README.md, tests/support/background-main.js, tests/support/app-entry.js, tests/e2e/create-collection.spec.js, tests/e2e/full-flow.spec.js, tests/e2e/rescan.spec.js, tests/e2e/smoke.spec.js, tests/e2e/tree-view.spec.js
**Done when:** Measured before and after by sampling the frontmost application: before, Electron was frontmost in 44 of 84 samples; after, the user's app was frontmost in 187 of 187 samples across 3 runs.
**Depends on:** 32
**Estimate:** 2
**Notes:** Commit 00ead68. Covers FR-19. Recorded after the work was done. States the measurements only; no cause is asserted for the earlier focus stealing.
**Done:** [x]

### Task 37: Drop the deprecated process.mainModule fallback from the IPC wrap helper
**What:** Remove the `process.mainModule` fallback in tests/support/ipc-wrap.js and rely on `process.getBuiltinModule`.
**Files:** tests/support/ipc-wrap.js, tests/unit/ipc-wrap.test.js
**Done when:** Measured: Electron 44.9.0 bundles Node 24.22.0, which provides `process.getBuiltinModule`; the helper no longer references `process.mainModule`.
**Depends on:** 31
**Estimate:** 1
**Notes:** Commit b31a62d. Covers FR-19. Recorded after the work was done.
**Done:** [x]

### Task 38: Attach the folder picker to the app window even when it is not focused
**What:** Open the folder picker against the main-window reference instead of `getFocusedWindow`, so it attaches to the app window when the window is unfocused.
**Files:** src/main/main.js, tests/e2e/create-collection.spec.js
**Done when:** A new e2e check failed with `getFocusedWindow` and passes with the main-window reference.
**Depends on:** 36
**Estimate:** 1
**Notes:** Commit a411e5d. Covers FR-1. Recorded after the work was done.
**Done:** [x]

### Task 39: Cover folders macOS refuses with EPERM
**What:** Add tests, with the EPERM refusal simulated, that document the current behaviour for a folder macOS refuses to read.
**Files:** tests/unit/collection-service.test.js
**Done when:** Tests pass showing that create rejects with an error naming EPERM, and that a folder refused after creation is unavailable on load and skipped by rescan.
**Depends on:** 29
**Estimate:** 1
**Notes:** Commit 0603ea7. Covers FR-4, FR-20. Recorded after the work was done; the EPERM refusal is simulated, not produced by macOS. The tests document current behaviour. Whether creation should instead accept a refused folder and mark it unavailable is an open product question; it is not decided here.
**Done:** [x]

## Summary
- Total tasks: 39
- Total estimated effort: 96 points
- Critical path: 1 → 3 → 8 → 9 → 11 → 13 → 14 → 15 → 16 (tasks 1-16); review-fix chain after 15: 17 → 19 → 20 → 25 → 26; follow-ups after 26: 27 → 29 → 30, 27 → 31 → 32, 21 → 28, measurements 33 (after 26) and 34 (after 9), and done records 28 → 35, 32 → 36 → 38, 31 → 37, 29 → 39
- Risks: Task 1 (Electron binary download may fail in the sandbox; Playwright's Electron support with Electron 44 is unverified and blocks every e2e task, 13 to 16); Task 7 (external and network volumes need the user's hardware); Task 4 (JSON store scale is unmeasured); Task 14 (virtualized rendering bound is chosen by the implementer); Task 5 (ctime/birthtime/atime ordering is subtle); Tasks 17-26 are review fixes sequenced by shared files (17 first; the rest follow in dependency order; each task cites its review finding number, which differs from the task number); Tasks 27-39 are follow-ups (35-39 recorded as already done), of which 33 and 34 produce measurements only and 28 may find behaviour that needs a product decision about migrating older store formats.

## Open Questions
- When the user picks a folder that macOS refuses (EPERM), should creating the collection fail (current behaviour) or add the folder as unavailable? Impact: FR-1, FR-4. Owner: Product owner.
