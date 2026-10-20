# Tasks: Manage and switch between collections

**Spec:** `specs/features/collection-management.md`
**Branch:** `feat/collection-management`
**Estimation unit:** story points (1/2/3/5/8)

Conventions: every task names the FRs it covers in its Notes. Test commands use the existing npm scripts (`npm test` runs Vitest; `npm run test:e2e` runs Playwright; `npm run build` runs `node --check` over the listed files, so every new source file under `src/` must be added to the `build` script in `package.json` in the task that creates it; several tasks therefore touch the same `package.json` line and must be merged or run one after another). E2E tests run through `tests/support/background-main.js`, stub the folder picker with `stubFolderPicker` and the confirmation with `stubConfirm` (Task 14), and never show a real dialog or window. Where a task says "relaunch" it closes the app, reopens it with `launchApp` on the same user data dir, and reads the result from the UI.

Design decisions made by this breakdown (they follow from the spec and the shipped code, not from new product choices):
- Confirmations live in the main process, inside the service operation they guard. `createCollectionService` takes an injected `confirm({ title, message, detail, confirmLabel })` returning `Promise<boolean>`; `deleteCollection`, `addFolder` (overlap) and `createCollection` (overlap among picked folders) call it. A missing `confirm` counts as "cancel" (safe default). The renderer therefore has no dialog code and cannot skip a confirmation. A cancelled action returns `{ canceled: true }` and writes nothing.
- Dialog seam: `src/main/confirm.js` exports `createConfirmer({ dialog, getWindow })`, which uses `dialog.showMessageBox` (buttons: the confirm label and "Cancel", default and cancel on "Cancel"). `main.js` injects it. For e2e, `tests/support/background-main.js` gives the app a proxied `dialog` whose `showMessageBox` never reaches the real function: it records the options in `globalThis.__moConfirms` and answers from a queue set by `stubConfirm(app, answers)` in `tests/support/e2e-app.js` (default answer when the queue is empty: Cancel, so an unexpected dialog cancels and is visible in `confirmCalls`). Every other `dialog` member (including `showOpenDialog`, replaced by `stubFolderPicker`) goes to the real object. `ipc-wrap.js` is not used for the confirmation because wrapping a channel would bypass the service code under test.
- New channels (all through `guard`, mirrored in `preload.js`): `collections:rename (id, name)`, `collections:delete (id)`, `collections:addFolder (collectionId, dirPath)`, `collections:removeFolder (collectionId, folderId)`. `collections:create` may now return `{ ok: true, canceled: true }`. `addFolder` and `removeFolder` return the refreshed `view`. The renderer adds the picked folders one `addFolder` call at a time.
- Error codes: `COLLECTION_BUSY` (a management action while the collection's rescan or add-folder scan runs; a rescan refused because an add-folder scan runs also uses it, a second rescan keeps `RESCAN_IN_PROGRESS`) and `LAST_FOLDER` (removing the only folder).
- In-flight guard: `src/main/collections/in-flight.js` (`createInFlightGuard()`) is one instance created in `main.js` and passed to both the rescan service and the collection service. Rename and remove-folder are synchronous, so they only check it; add-folder holds it for the whole scan; delete holds it from before the confirmation until after the delete, so a rescan cannot start during the dialog. The renderer mirrors it in `src/renderer/collection-busy.js` and disables the controls.
- Storage keeps format 1 and gains no new record fields. `putFolder` appends the folder id to the owning collection's `folderIds` if the collection exists and the id is absent; `removeFolder` and `removeCollection` remove ids. Rename uses `putCollection`. A v1 store written before this feature may have a `folderIds` that lacks some of its folders; ordering code treats a folder missing from `folderIds` as later than every listed one, ties broken by folder id.
- Overlap rules live in `src/shared/path-compare.js` (pure string logic, dual-use like `tree-model.js`) and are used twice: by `src/main/collections/overlap.js` for the add-folder/creation confirmation (adds `path.resolve` and `realpath` for roots that exist) and by `tree-model.js` for de-duplication.
- The renderer cannot call `realpath`, so de-duplication gets symlink resolution from the main process: `collectionView` adds a derived, never persisted `resolvedPath` to each folder (`fs.realpathSync`, falling back to `path`), the same way the file-level `unavailable` flag is derived. `buildTree` compares `resolvedPath || path`. Folders in a view are ordered by the collection's `folderIds`, which is the tie-break order for identical paths.
- De-duplication detail: a file under an inner root is dropped only when an owning root (an outer root, or an earlier root with the identical path) holds a record for the same file path in its own index. If the owner has no record (its index is stale), the inner root keeps the file so it is never hidden by an index that does not list it. When indexes agree this is the FR-9 rule exactly. The spec does not state the stale case; this is a choice made here.
- Renderer: `src/renderer/collection-manage.js` is a panel for the selected collection (rename, delete, folder list with Remove, Add folder). It dispatches `collections-changed` on `document` (`detail: { kind, collectionId }`); `create-collection.js` listens, refreshes the list, and after a delete of the selected collection clears the tree with `TreeView.show([], [])` and dispatches `collection-selected` with `collectionId: null` (the Rescan button already disables on that).

### Task 1: Storage keeps CollectionRecord.folderIds consistent
**What:** Make `putFolder`, `removeFolder` and `removeCollection` in `src/main/storage/index.js` maintain the owning collection's `folderIds` without changing the store format.
**Files:** src/main/storage/index.js, tests/unit/storage.test.js
**Done when:** `npx vitest run tests/unit/storage.test.js` exits 0, with new tests asserting: `putFolder` of a new folder appends its id to its collection's `folderIds` once, and putting the same folder again does not duplicate it; `putFolder` for a collection that does not exist stores the folder and throws nothing; `removeFolder(id)` removes the id from the owning collection's `folderIds`, drops that folder's index and access data, and leaves every other folder and collection (including a second collection that holds a folder with the identical path) identical; `removeFolder` of an unknown id changes nothing; `removeCollection(id)` removes the collection, its folders, indexes and access data and leaves a second collection's records for the same paths identical; inside `transaction`, an exception thrown after a `removeFolder` leaves the store unchanged in memory and on disk; `FORMAT_VERSION` is still 1 and the saved JSON has no new top-level keys; existing storage tests still pass.
**Depends on:** none
**Estimate:** 3
**Notes:** Covers FR-4, FR-11 (rollback is the existing `transaction` snapshot; this task tests it with the new mutations), FR-13 (storage operations, "another collection untouched", `folderIds` consistent) and FR-6 (two collections, same path, separate records). Some existing storage tests call `putFolder` for a collection created with `folderIds: []`; those now get the id appended, so update only assertions that compare `folderIds` exactly. No rename function is added: rename is `putCollection` with a new `name`. Edits `src/main/storage/index.js` and updates the header comment that lists the API.
**POS:** task_8e5834b5
**Done:** [x]

### Task 2: Shared pure path comparison
**What:** Add `src/shared/path-compare.js`, a DOM-free, Node-free module that normalises an absolute path string and answers "same", "inside" and "contains" by whole segments, case-insensitively.
**Files:** src/shared/path-compare.js, tests/unit/path-compare.test.js, package.json (add `node --check src/shared/path-compare.js` to `build`)
**Done when:** `npx vitest run tests/unit/path-compare.test.js && npm run build` exits 0, with tests asserting: `/a/b/c` is inside `/a/b`; `/a/b` contains `/a/b/c`; `/a/b` and `/c/d` are unrelated; `/a/bc` is not inside `/a/b` and `/a/b` is not inside `/a/bc`; `/a/b/` (trailing slash) compares equal to `/a/b`; `/A/B` compares equal to `/a/b` and `/A/B/c` is inside `/a/b`; repeated separators and `.` segments collapse (`/a//b/./c`); the filesystem root `/` contains every path and is inside none but itself; identical paths report `same` and not `inside`; the module exports through `module.exports` under Node and as `globalThis.PathCompare` when `module` is undefined (checked by evaluating the file in a `vm` context without `module`).
**Depends on:** none
**Estimate:** 2
**Notes:** Covers FR-8 (the pure-string half: whole segments, trailing slash, case) and FR-9 (the same logic is reused by `tree-model.js` in Task 11). Follow the export block of `src/shared/tree-model.js`. POSIX separators only (macOS first); document that in the header. No `path`, `fs` or `realpath` here: symlinks are Task 3 (main process) and Task 10 (derived `resolvedPath`).
**POS:** task_5d796af2
**Done:** [x]

### Task 3: Overlap detection module
**What:** Add `src/main/collections/overlap.js` exporting `findOverlaps(candidatePath, existingPaths, { realpath })` and `describeOverlap(result, candidatePath)`, which classify a folder being added against a collection's folders and produce the confirmation wording.
**Files:** src/main/collections/overlap.js, tests/unit/overlap.test.js, package.json (add `node --check src/main/collections/overlap.js` to `build`)
**Done when:** `npx vitest run tests/unit/overlap.test.js && npm run build` exits 0, with tests asserting `findOverlaps` results for: inside an existing folder (`covered` names that folder); containing an existing folder (`contains` lists that folder, not `covered`); unrelated (both empty); `/a/b` against `/a/bc` (no overlap, either direction); trailing slash (`/a/b/` against `/a/b` is `covered`); case difference (`/A/B` against `/a/b/c` is `contains`); symlink (a temp directory symlinked to another temp directory that is an existing folder is `covered`, using the real default `realpath`); identical path is `covered` by that folder; a candidate that does not exist is compared by `path.resolve` only and does not throw; an injected `realpath` that throws for one path falls back to `path.resolve` for it; `describeOverlap` returns, for `covered`, text containing "already covered" and the overlapping folder's path, and for `contains`, text containing "the collection already contains a folder inside the one being added" and that folder's path, and for both at once a single message listing both; no overlap gives `null`.
**Depends on:** 2
**Estimate:** 3
**Notes:** Covers FR-8 (seven listed cases plus identical path, wording, naming the overlapping folder) and FR-13 (overlap unit tests). Pure apart from the injected `realpath` (default `fs.realpathSync`); no confirmation dialog here, only the text. When several existing folders overlap, name the first in the given order and mention the count.
**POS:** task_7513335f
**Done:** [x]

### Task 4: In-flight guard shared by rescan and management actions
**What:** Add `src/main/collections/in-flight.js` (`createInFlightGuard()`) and make the rescan service use it, so a rescan and an add-folder scan of one collection can exclude each other.
**Files:** src/main/collections/in-flight.js, src/main/collections/rescan.js, src/main/main.js, tests/unit/in-flight.test.js, tests/unit/rescan.test.js, package.json (add `node --check src/main/collections/in-flight.js` to `build`)
**Done when:** `npx vitest run tests/unit/in-flight.test.js tests/unit/rescan.test.js && npm run build` exits 0, with tests asserting: `guard.acquire(id, kind)` returns a release function; a second `acquire` for the same id throws an error with `code === 'COLLECTION_BUSY'` whose message names the holding kind; an `acquire` for a different id succeeds; release makes the id acquirable again and calling release twice is harmless; `guard.isBusy(id)` reflects the state; `createRescanService({ storage, scan, guard })` still rejects a second rescan of the same collection with `RESCAN_IN_PROGRESS` and still does not run discovery for it; a rescan started while the guard is held with kind `add-folder` rejects with `COLLECTION_BUSY` and runs no discovery; a guard held by a rescan is released after success and after a failing scan; with no `guard` passed the service creates its own and the existing rescan tests pass unchanged. `main.js` creates one guard and passes it to `createRescanService`.
**Depends on:** none
**Estimate:** 3
**Notes:** Covers FR-12 (main-process half, rescan side) and FR-13 (in-flight refusals). Replaces the private `inFlight` Set in `rescan.js`; keep `RESCAN_IN_PROGRESS` for rescan versus rescan and update the header comment. Edits `main.js` (also edited by Task 12) and `rescan.js`. The collection service receives the same guard in Tasks 6 to 8; `main.js` passes it to the service in Task 12.
**POS:** task_8124a388
**Done:** [x]

### Task 5: Main-process confirmer
**What:** Add `src/main/confirm.js` exporting `createConfirmer({ dialog, getWindow })`, returning `confirm({ title, message, detail, confirmLabel })` that resolves true only when the user chooses the confirm button.
**Files:** src/main/confirm.js, tests/unit/confirm.test.js, package.json (add `node --check src/main/confirm.js` to `build`)
**Done when:** `npx vitest run tests/unit/confirm.test.js && npm run build` exits 0, with tests using a fake `dialog.showMessageBox` asserting: the options carry `type: 'warning'`, the given title, message and detail, `buttons` equal to `[confirmLabel, 'Cancel']`, `defaultId` and `cancelId` equal to 1; response 0 resolves true; response 1 resolves false; a closed dialog (rejected promise) rejects, not true; with a window from `getWindow` the call is `showMessageBox(win, options)`, with `null` it is `showMessageBox(options)`; a destroyed window is not passed.
**Depends on:** none
**Estimate:** 2
**Notes:** Covers the confirmation requirements of FR-2 and FR-8 (the dialog seam; wording is built by the callers) and FR-13 (testability without a modal). Mirrors how `ipc.js` passes the window to `showOpenDialog`. Wiring into `main.js` is Task 12; the e2e stub is Task 14.
**POS:** task_95084259
**Done:** [x]

### Task 6: Service rename and remove folder
**What:** Add `renameCollection(id, name)` and `removeFolder(collectionId, folderId)` to the collection service, with trimming, last-folder refusal, busy refusal and one transaction each.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js` exits 0, with new tests asserting: rename trims the name and the stored name changes while `folderIds`, folders and index are byte-identical; an empty or whitespace-only name rejects and the store is unchanged; a duplicate name is accepted; a 5000-character name is accepted; an unknown collection id rejects; `removeFolder` removes the folder record, its index and its id from `folderIds`, returns the refreshed view, and does not touch a second collection that has a folder with the same path; removing the only folder rejects with `code === 'LAST_FOLDER'` and a message that suggests deleting the collection, and the store is unchanged; a folder id that belongs to another collection rejects and nothing changes; with the guard held for that collection (kind `add-folder`) both operations reject with `code === 'COLLECTION_BUSY'` and the store is unchanged, while the same operations on another collection succeed; a failure injected after the first write inside the transaction (a `storage` whose `removeFolder` throws after `replaceFolderIndex`) leaves the store unchanged; the number of store writes per successful action is exactly 1.
**Depends on:** 1, 4
**Estimate:** 3
**Notes:** Covers FR-1, FR-3, FR-4, FR-11, FR-12 (busy refusal for rename and remove) and FR-13. `createCollectionService` gains `guard` (default: its own) and `confirm` (default: none) parameters; update the header comment. Tasks 6 to 10 all edit `service.js` and `collection-service.test.js`, so they run one after another. Count writes with the `fs` seam of `openStorage` as `storage.test.js` does.
**POS:** task_04156a16
**Done:** [x]

### Task 7: Service delete collection with confirmation
**What:** Add `deleteCollection(id)` to the collection service: it holds the guard, asks the injected `confirm`, and on confirmation removes the collection in one transaction.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js` exits 0, with new tests asserting: the confirmation is asked before any write, its message contains the collection name and states that no files on disk are touched, and the confirm label is "Delete collection"; confirm true removes the collection, its folders, indexes and access data and resolves `{ deleted: true }`, and a second collection with the same folder paths is byte-identical afterwards; confirm false resolves `{ canceled: true }` and the store is unchanged and not written; with no `confirm` injected the result is `{ canceled: true }` and nothing is written; an unknown id rejects without asking; the guard is held while `confirm` is pending (a concurrent `renameCollection`, `removeFolder` and `rescanCollection` for the same collection reject with `COLLECTION_BUSY`, another collection is unaffected) and released after confirm, cancel and a throwing `confirm`; if the guard is held when `deleteCollection` is called it rejects with `COLLECTION_BUSY` before asking; a throwing `storage.removeCollection` leaves the store unchanged; the delete touches no file system path (the test passes a `scan` that fails if called and checks the fixture directory listing is unchanged).
**Depends on:** 1, 4, 6
**Estimate:** 3
**Notes:** Covers FR-2, FR-4, FR-11, FR-12 and FR-13. Delete must never call into a collection folder: it only edits the store.
**POS:** task_c29fa0c5
**Done:** [x]

### Task 8: Service add folder with overlap confirmation
**What:** Add `addFolder(collectionId, dirPath)` to the collection service: validate, check overlap, confirm if needed, scan only the new folder, and store it in one transaction.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js` exits 0, with new tests asserting: a readable absolute directory is added, indexed (its files are in the index), its id is appended to `folderIds`, the other folders of the collection are not scanned (the injected `scan` is called once, with the new path), and the store is written once; a relative path, a file, a missing path and a directory that cannot be opened for listing each reject with an error that names the folder and leave the store unchanged; a directory containing the app storage file is rejected as in creation; a folder inside an existing folder asks `confirm` with text containing "already covered" and the existing folder's path, confirm true stores it and both folders remain, confirm false resolves `{ canceled: true }` with no folder record, no index entry, no `scan` call and no write; a folder containing an existing folder asks with the "already contains a folder inside the one being added" text naming that folder; an identical path asks with the "already covered" text; a path with no overlap does not call `confirm`; the same path added to a second collection stores a separate `FolderRecord` with a new id and its own index and changes nothing in the first collection; the guard is held during the scan (a concurrent `renameCollection`, `deleteCollection`, `removeFolder` and `rescanCollection` for that collection reject with `COLLECTION_BUSY`, another collection works) and released afterwards, including when the scan fails; an add refused as busy does not scan or ask; a folder that passes the readability check but whose scan fails is stored with `unavailable: true` and an empty index, as in creation; a failure injected during the transaction leaves the store unchanged.
**Depends on:** 1, 3, 4, 7
**Estimate:** 5
**Notes:** Covers FR-6, FR-7, FR-8, FR-11, FR-12, FR-4 (`folderIds` append) and FR-13. Refactor the existing private `validate` so creation and add share the absolute/readable/storage-file checks (keep creation behaviour and messages). Order: busy check, validation, overlap check, confirm, then acquire-and-scan; confirm happens before any scan, so a cancel costs nothing. Hold the guard from before the confirmation so a rescan cannot start while the dialog is open.
**POS:** task_fd3b4b30
**Done:** [x]

### Task 9: Overlap confirmation at collection creation
**What:** Make `createCollection` ask for confirmation when the picked folders overlap each other, and return `{ canceled: true }` without writing when the user cancels.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js` exits 0, with new tests asserting: two picked folders where one is inside the other call `confirm` once with the overlap wording naming the overlapping folder; confirm true creates the collection with both folders; confirm false resolves `{ canceled: true }`, nothing is scanned or stored; three folders with two overlapping pairs ask once, naming the first overlap and counting the others; non-overlapping folders and duplicates that collapse to one path (existing behaviour) do not call `confirm`; the same folder path in two separate collections is accepted without a prompt; with no `confirm` injected an overlapping creation resolves `{ canceled: true }`; all pre-existing `createCollection` tests pass unchanged.
**Depends on:** 3, 8
**Estimate:** 2
**Notes:** Covers FR-8 (creation case) and FR-6 (same folder in several collections at creation). A folder given twice is de-duplicated by the existing `path.resolve` collapse and is not an overlap prompt at creation; an identical path matters only against a collection's existing folders. The overlap check runs after validation and before any scan.
**POS:** task_5ad00b33
**Done:** [x]

### Task 10: Collection view orders folders and derives resolvedPath
**What:** Make `collectionView` return folders in `CollectionRecord.folderIds` order (unlisted folders last, by id) and add a derived, non-persisted `resolvedPath` to each returned folder.
**Files:** src/main/collections/service.js, tests/unit/collection-service.test.js
**Done when:** `npx vitest run tests/unit/collection-service.test.js tests/unit/rescan.test.js` exits 0, with new tests asserting: folders come back in `folderIds` order regardless of storage insertion order; a folder missing from `folderIds` comes after the listed ones; `resolvedPath` equals `fs.realpathSync(path)` for an existing folder, including when the folder is a symlink to another directory; for a missing folder `resolvedPath` equals `path`; the stored folder record has no `resolvedPath` (the store JSON is unchanged after a view); `getCollectionView` and the rescan view carry the same fields; file records and the derived `unavailable` flag are unchanged.
**Depends on:** 9
**Estimate:** 2
**Notes:** Covers FR-9 (inputs needed by the build-time rule: the tie-break order and symlink resolution) and FR-6 (v1 stores whose `folderIds` is stale still list every folder). `rescan.js` calls the same `collectionView`, so it gains the fields with no change. `collections:list` summaries are not changed. Sync `realpathSync` on a handful of roots is cheap; record it in the header comment.
**POS:** task_688dc8e9
**Done:** [x]

### Task 11: Tree build de-duplication
**What:** Make `buildTree` in `src/shared/tree-model.js` show a file once per collection by dropping it from an inner root (or a later identical root) when an owning root holds a record for it.
**Files:** src/shared/tree-model.js, src/renderer/index.html, tests/unit/tree-model.test.js
**Done when:** `npx vitest run tests/unit/tree-model.test.js` exits 0, with new tests asserting: with roots `/m` and `/m/sub` and a file indexed under both, the file appears under `/m` only and the `/m/sub` root is still returned (empty if it had nothing else); the "contains" direction is the same (adding the outer root last gives the same tree as adding it first); two roots with identical paths keep the file under the root that comes first in the given folder order and drop it from the other; three nested roots show each file once under the outermost root that has a record for it; a file under an inner root that the outer root has no record for (stale outer index) is kept under the inner root; roots whose paths are `/a/b` and `/a/bc` do not interact; case-different roots (`/A/B`, `/a/b`) interact; roots with different paths but equal `resolvedPath` interact as identical; a root with no `resolvedPath` uses `path`; node ids stay `<rootFolderId>:<relativePath>` and every id in the result is unique (no id appears twice across roots); removing the outer root from the input makes the file appear under the inner root; results are deterministic for the same input; an unavailable outer root still owns the file; performance guard: 20,000 records across two overlapping roots build without a quadratic pattern (the test asserts the call finishes within 2 seconds).
**Depends on:** 2, 10
**Estimate:** 3
**Notes:** Covers FR-9 and FR-13 (one-appearance rule, identical-path tie-break). Input order of `folderRecords` is the tie-break order (Task 10 supplies it). Load `../shared/path-compare.js` in `index.html` before `tree-model.js`; in `tree-model.js` take `PathCompare` from `require('./path-compare.js')` under Node and from `globalThis.PathCompare` in the renderer. Build per-root sets of normalised file paths so the check is a set lookup, not a scan. The stale-owner choice is recorded in the design decisions above. Edits `index.html` (also edited by Tasks 15, 16, 17, 19, 21).
**POS:** task_53b3b91e
**Done:** [x]

### Task 12: IPC channels, preload and main wiring for management
**What:** Add the rename, delete, add-folder and remove-folder channels to `ipc.js`, mirror them in `preload.js`, make `collections:create` pass through a cancel, and wire the confirmer and shared guard in `main.js`.
**Files:** src/main/ipc.js, src/main/preload.js, src/main/main.js, tests/unit/ipc.test.js
**Done when:** `npx vitest run tests/unit/ipc.test.js && npm run build` exits 0, with tests asserting: `CHANNELS.renameCollection`, `.deleteCollection`, `.addFolder`, `.removeFolder` equal `'collections:rename'`, `'collections:delete'`, `'collections:addFolder'`, `'collections:removeFolder'` and are registered; each calls the matching service method once with its arguments and returns `{ ok: true, ... }` (rename returns the summary `{ id, name, folderCount }`; add and remove return `view`; delete returns `{ deleted: true }`); a `{ canceled: true }` result from the service for delete, add-folder or create comes back as `{ ok: true, canceled: true }`; a thrown error with `code` `COLLECTION_BUSY` or `LAST_FOLDER` comes back as `{ ok: false, error, code }`; a non-string collection id or folder path is rejected with `{ ok: false, error }` before the service is called; a text check that `preload.js` exposes `renameCollection`, `deleteCollection`, `addFolder` and `removeFolder` invoking the four literal channel names; a text check that `main.js` constructs `createConfirmer`, passes `confirm` and the shared `guard` to `createCollectionService`, and passes the same `guard` to `createRescanService`.
**Depends on:** 5, 6, 7, 8, 9
**Estimate:** 3
**Notes:** Covers FR-1, FR-2, FR-3, FR-7 (interface), FR-8 (creation cancel passes through), FR-11 and FR-12 (errors reach the renderer with codes). Update the header comment listing the channels in `ipc.js`. The channel names are duplicated as literals in `preload.js` (sandboxed preload, as for the existing channels). Edits `main.js` (also edited by Task 4, which must be merged first).
**POS:** task_31648ad6
**Done:** [x]

### Task 13: A version-1 store written before this feature still opens and works
**What:** Add a v1 store fixture produced by the shipped code and tests proving it opens unchanged and its collections still work with every new operation.
**Files:** tests/fixtures/v1-store/media-organizer-store.json (generated once by a script run on the pre-feature code, the generating commit recorded in `tests/fixtures/v1-store/README.txt`), tests/unit/v1-store.test.js
**Done when:** `npx vitest run tests/unit/v1-store.test.js` exits 0, with tests asserting: opening the fixture with `openStorage` and `startStorage` succeeds with the same collections, folders and index as listed in the README; a `folderIds` that lacks one of its collection's folders (as the pre-feature code could leave it) still lists that folder in `collectionView`; the file read before and after opening is byte-identical (opening alone writes nothing); `getCollectionView`, `listCollectionSummaries`, `renameCollection`, `removeFolder`, `addFolder` (against a temp directory) and `deleteCollection` (confirm true) each work on a copy of the fixture, and after each of them the saved file still has `"version": 1` and the untouched collections are byte-identical in the JSON; a store written by `createCollection` in the test itself (current code) opens with the same assertions; a store with `version: 2` still fails to open with reason `unsupported-format` and is not modified.
**Depends on:** 6, 7, 8
**Estimate:** 3
**Notes:** Covers FR-6 (no format bump, existing v1 store opens unchanged), FR-11 and FR-4. Generate the fixture with a throwaway script (not committed) that runs `createCollection` through the service on the code at the commit before Task 1, over a small temp tree, then replace the temp root with a placeholder that the test rewrites to a fresh temp path before opening. Include two collections that share one folder path as separate records, one folder missing from `folderIds`, and one `unavailable: true` folder. The test must not depend on the fixture's recorded paths existing.
**POS:** task_fadd843e
**Done:** [x]

### Task 14: E2E confirmation stub and its smoke test
**What:** Give the app a `dialog.showMessageBox` stub in `tests/support/background-main.js`, add `stubConfirm` and `confirmCalls` to `e2e-app.js`, and prove the stub and the delete channel with one e2e.
**Files:** tests/support/background-main.js, tests/support/e2e-app.js, tests/e2e/confirm-stub.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/confirm-stub.spec.js` exits 0, with tests that build two collections from the fixture tree before launch, launch through `launchApp`, and assert: `confirmCalls(app)` is `[]` after launch; with `stubConfirm(app, [false])`, `window.evaluate(id => window.mediaOrganizer.deleteCollection(id), id)` resolves `{ ok: true, canceled: true }` and `confirmCalls(app)` has one entry whose options contain the collection name, the text "no files on disk" (case-insensitive) and buttons `['Delete collection', 'Cancel']`, and the store read through `openStorage` after closing still has the collection; with `stubConfirm(app, [true])` the same call resolves `{ ok: true, deleted: true }` and the collection is gone from the store; with no queued answer a delete call is cancelled (default) and recorded; `stubFolderPicker` still works in the same run (the picker stub and the `showMessageBox` stub do not interfere); no window comes to the front (the run is hidden; no `MO_E2E_VISIBLE`).
**Depends on:** 12
**Estimate:** 3
**Notes:** Covers FR-13 (e2e stub seam, no real modal) and the confirmation half of FR-2. The proxy in `background-main.js` must be added next to the existing `ipcMain` and `shell` proxies (extend the `get` trap with `key === 'dialog'`): every key except `showMessageBox` is forwarded to the real `dialog` with `this` bound, so a later `dialog.showOpenDialog = ...` assignment made by `stubFolderPicker` through `app.evaluate` (which sees the real module) is still seen by the app. The stub never calls the real `showMessageBox`, also under `MO_E2E_VISIBLE=1`; document it in the header comment. `stubConfirm(app, answers)` takes an array of booleans consumed in order; `confirmCalls(app)` returns the recorded option objects.
**POS:** task_b3af2a8f
**Done:** [x]

### Task 15: Renderer in-flight state shared by controls
**What:** Add `src/renderer/collection-busy.js` (`CollectionBusy.begin(id)`, `end(id)`, `isBusy(id)`, firing `collection-busy-changed` on `document`) and make the Rescan button use it.
**Files:** src/renderer/collection-busy.js, src/renderer/rescan-button.js, src/renderer/index.html, package.json (add `node --check src/renderer/collection-busy.js` to `build`), tests/e2e/rescan.spec.js
**Done when:** `npm run build` exits 0 and `npm run test:e2e -- tests/e2e/rescan.spec.js` exits 0 with its existing tests unchanged and passing (button disabled while the selected collection rescans, per collection, result for a deselected collection ignored), plus one new test asserting `window.CollectionBusy.isBusy(id)` is true while a gated `collections:rescan` is held (`gateChannel`) and false after release; `rescan-button.js` no longer holds its own `Set`; `collection-busy-changed` fires once per begin and once per end with `detail.collectionId`.
**Depends on:** none
**Estimate:** 2
**Notes:** Covers FR-12 (renderer half, shared state for Task 23). Behaviour of the Rescan button must not change. Load `collection-busy.js` before `rescan-button.js` in `index.html`. Edits `index.html` (also edited by Tasks 11, 16, 17, 19, 21) and `rescan-button.js`.
**POS:** task_90b180c9
**Done:** [x]

### Task 16: Management panel and rename in the UI
**What:** Add the management panel for the selected collection with a rename field and button, `collections-changed` wiring in `create-collection.js`, and an e2e of rename.
**Files:** src/renderer/collection-manage.js, src/renderer/index.html, src/renderer/create-collection.js, src/renderer/styles.css, package.json (add `node --check src/renderer/collection-manage.js` to `build`), tests/e2e/collection-rename.spec.js
**Done when:** `npm run build` exits 0 and `npm run test:e2e -- tests/e2e/collection-rename.spec.js tests/e2e/create-collection.spec.js` exits 0, with a rename test asserting: before any collection is selected the panel (`data-testid="manage-panel"`) is hidden or its controls are disabled; selecting a collection shows its name in `[data-testid="rename-input"]`; typing `  Holiday  ` and clicking `[data-testid="rename-button"]` makes the matching `collection-name-label` read exactly `Holiday` immediately and the selected collection stays selected with its tree unchanged; after closing and relaunching the app the list shows `Holiday`; an empty and a whitespace-only name show an error in `[data-testid="manage-error"]` (`role="alert"`), the label and the store are unchanged; renaming to the name another collection has is accepted; a 300-character name is accepted and shown; the folders and files of the collection are the same before and after (compare tree rows and the store's folders and index); no `confirmCalls` entry is made by a rename.
**Depends on:** 12, 14
**Estimate:** 3
**Notes:** Covers FR-1 and FR-13 (e2e with relaunch). The panel manages the collection that `collection-selected` last announced and clears itself when the announcement has `collectionId: null`. After a successful action the panel dispatches `collections-changed`; `create-collection.js` listens and calls its `refreshCollections`, keeping the selected highlight. Tasks 16, 17, 19, 21 and 23 all edit `collection-manage.js` and `index.html`, and 16, 21 and 22 edit `create-collection.js`; they run one after another in id order. Rename is not offered while the collection is busy (the disabling is Task 23).
**POS:** task_0a1f6773
**Done:** [x]

### Task 17: Folder list and Remove folder in the UI
**What:** Show the selected collection's folders in the panel, each with a Remove button, wired to `collections:removeFolder` with an in-place tree refresh.
**Files:** src/renderer/collection-manage.js, src/renderer/index.html, src/renderer/styles.css, tests/e2e/folder-remove.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/folder-remove.spec.js` exits 0, with a test on a collection of two fixture folders asserting: the panel lists both folder paths (`data-testid="manage-folder"`, one per folder) with an "unavailable" label for an unavailable one; clicking Remove on the second removes its entry and its root and files from the tree at once, without a rescan (`gateChannel` on `collections:rescan` shows zero calls) and the first folder's rows are unchanged; the collection list shows "(1 folders)" or the same count text format as before with the new count; after relaunch the removed folder is not in the list or the tree; the files on disk of the removed folder still exist (listing compared before and after); no confirmation dialog is shown (`confirmCalls` is `[]`).
**Depends on:** 16
**Estimate:** 3
**Notes:** Covers FR-3 (UI, in-place refresh, persistence) and FR-13. After removal the renderer calls `TreeView.update(view.folders, view.files)` when the removed-from collection is the selected one, which keeps the selection only if its node id still exists (the existing rule); the selection behaviour is asserted in Task 18. Removal needs no confirmation (the spec asks for one only for delete and overlap). The last-folder refusal message shows in `manage-error` (asserted in Task 18). Uses `summaries[].folders` from `collections:list` for the list; refresh it from `collections-changed`.
**POS:** task_87039237
**Done:** [x]

### Task 18: E2E remove-folder selection rule and last-folder refusal
**What:** Add e2e tests for how a file selection survives a folder removal and for refusing to remove the last folder.
**Files:** tests/e2e/folder-remove-selection.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/folder-remove-selection.spec.js` exits 0, with tests asserting: select a file in the kept folder, remove the other folder: the file stays selected (`aria-selected="true"`) and the detail area still shows its path; select a file in the folder that is then removed: no row is selected, the detail path is the empty state and Reveal is disabled; removing the last remaining folder shows an error in `manage-error` that contains "delete the collection", the Remove button of that folder is still present, and the store (read after closing) still has the folder and its `folderIds`; a folder removed from a non-active collection (done through the channel while another collection is shown) leaves the shown tree and selection unchanged.
**Depends on:** 17
**Estimate:** 2
**Notes:** Covers FR-3 (selection rule, last-folder refusal) and FR-13. Spec-only task, so it can run beside Task 19.
**POS:** task_9427a724
**Done:** [x]

### Task 19: Add folder to an existing collection in the UI
**What:** Add an "Add folder" button to the panel that uses the folder picker, adds each picked folder through `collections:addFolder`, refreshes the tree in place, and shows errors.
**Files:** src/renderer/collection-manage.js, src/renderer/index.html, src/renderer/styles.css, tests/e2e/folder-add.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/folder-add.spec.js` exits 0, with tests using `stubFolderPicker` asserting: the picker is called with directories only options (`properties` contains `openDirectory` and not `openFile`); picking a second fixture folder adds a root and its files to the tree and a `manage-folder` entry without a prompt (`confirmCalls` is `[]`); only the new folder is scanned (the first folder's records in the store are identical before and after, compared as JSON) and `collections:rescan` has zero calls; the new folder and its files are present after relaunch; picking a folder that cannot be opened for listing (a `chmod 000` copy; skipped with a stated reason when running as root) shows an error naming the folder in `manage-error`, no root appears and the store is unchanged; picking two folders in one pick adds both in order; the collection selected stays selected and a selected file stays selected after the add.
**Depends on:** 14, 15, 17
**Estimate:** 3
**Notes:** Covers FR-7 and FR-13. While an add is in flight the panel marks the collection busy through `CollectionBusy.begin/end` (the disabling UI is Task 23). Restore permissions in `afterEach`; run `chmod` fixtures on a copy of the fixture tree (`lockFolder`/`unlockFolder` in `fixture-tree.js`). A cancelled picker (`canceled: true`) adds nothing; `stubFolderPicker` always answers with paths, so that case is covered by the unit tests of the picker handler already in `ipc.test.js`.
**POS:** task_19797402
**Done:** [x]

### Task 20: E2E overlap confirmation when adding a folder
**What:** Add e2e tests for the inside, contains, identical and non-overlap cases of adding a folder, with confirm and cancel.
**Files:** tests/e2e/folder-add-overlap.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/folder-add-overlap.spec.js` exits 0, with tests asserting: (inside) adding a subfolder of an existing folder with `stubConfirm(app, [false])` records one confirmation whose text contains "already covered" and the existing folder's path, and afterwards the tree, the panel list and the store (read after closing) are identical to before, with zero `collections:rescan` calls and no new index entries; the same with `[true]` adds the folder and keeps both, and both are present after relaunch; (contains) adding the parent of an existing folder asks with the text "the collection already contains a folder inside the one being added" naming that folder, cancel changes nothing, confirm keeps both; (identical) adding an identical path asks with "already covered", cancel leaves one folder record for that path, confirm gives two records with different ids; (symlink) a symlink to an existing folder asks with "already covered"; (unrelated) no confirmation is recorded; every case runs with a picker stub and a confirm stub only and no real dialog appears.
**Depends on:** 19
**Estimate:** 3
**Notes:** Covers FR-8 (dialog content, cancel writes nothing, confirm keeps both, identical path) and FR-13. The symlink case builds a link inside a temp directory next to the fixture; skip with a stated reason if the platform refuses symlinks. Spec-only task.
**POS:** task_5ca3e0e0
**Done:** [x]

### Task 21: Delete collection in the UI
**What:** Add a "Delete collection" button to the panel that calls `collections:delete`, and make the page clear the tree and selection when the active collection is deleted.
**Files:** src/renderer/collection-manage.js, src/renderer/create-collection.js, src/renderer/index.html, tests/e2e/collection-delete.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/collection-delete.spec.js` exits 0, with tests using `stubConfirm` asserting: clicking Delete with `[false]` records one confirmation containing the collection name and "no files on disk", and the list, tree, selection and store are unchanged; with `[true]` the item leaves the list at once, the tree area has no rows, no row is selected, `file-path` shows the empty state, Reveal and Rescan are disabled, the panel is hidden or disabled, and `collection-selected` was dispatched with `collectionId: null`; after relaunch the collection is not in the list and not in the store; the files and folders on disk of that collection are unchanged (directory listing compared before and after); with two collections sharing a folder path, deleting one leaves the other collection's tree, files and store records identical and it is still selectable after relaunch; deleting a collection that is not the active one leaves the shown tree and selection unchanged; no real dialog (the run is hidden, `confirmCalls` shows the single recorded dialog).
**Depends on:** 14, 19
**Estimate:** 3
**Notes:** Covers FR-2, FR-4 (shared-path survival in the UI) and FR-13. Clearing uses `TreeView.show([], [])` and a `collection-selected` event with `collectionId: null`; check that `rescan-button.js` and `file-detail.js` already handle null/cleared (they follow `collection-selected` and `file-selected`); fix only what the test shows is missing. Edits `create-collection.js` and `collection-manage.js` after Task 19 (declared dependency for file ordering).
**POS:** task_c16992ee
**Done:** [ ]

### Task 22: Overlap confirmation at creation in the UI
**What:** Make `create-collection.js` handle a cancelled creation (keep the form, show nothing created) and cover creation overlap with an e2e.
**Files:** src/renderer/create-collection.js, tests/e2e/create-overlap.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/create-overlap.spec.js tests/e2e/create-collection.spec.js` exits 0, with tests using `stubFolderPicker` and `stubConfirm` asserting: picking a folder and its subfolder, naming the collection and clicking Create asks one confirmation naming the overlapping folder; confirm true creates the collection with both folders and clears the form; confirm false leaves the name input and the folder list as they were, creates no collection (list and store unchanged, no scan) and no error is shown, and the user can then remove nothing and create again with `[true]`; the same folder created into two collections is accepted with no confirmation; existing creation tests still pass.
**Depends on:** 12, 14, 21
**Estimate:** 2
**Notes:** Covers FR-8 (creation case) and FR-6 (same folder at creation) in the UI. `collections:create` returns `{ ok: true, canceled: true }` on cancel; the current code would treat it as success and clear the form, so branch on `canceled` first. Edits `create-collection.js` after Task 21 (declared dependency for file ordering).
**POS:** task_982bde68
**Done:** [ ]

### Task 23: Disable management controls while a scan runs
**What:** Disable rename, delete, add-folder and remove-folder controls while the selected collection is busy, and show a clear refusal when the main process refuses.
**Files:** src/renderer/collection-manage.js, src/renderer/styles.css, tests/e2e/collection-busy.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/collection-busy.spec.js` exits 0, with tests asserting: with `gateChannel` holding `collections:rescan`, clicking Rescan makes `rename-button`, the delete button, the add-folder button and every folder Remove button disabled (`toBeDisabled`) and Rescan disabled; releasing the gate re-enables all of them; selecting another collection while the first is rescanning leaves the other collection's controls enabled and switching back shows them disabled again; with `gateChannel` holding `collections:addFolder` the same controls are disabled and re-enabled on release; calling each of the four channels directly through `window.mediaOrganizer` while the collection's rescan is held resolves `{ ok: false, code: 'COLLECTION_BUSY' }` with an error message, no confirmation recorded for delete, and the store (read after closing) unchanged; a rescan started through the channel while an add-folder is held resolves `{ ok: false, code: 'COLLECTION_BUSY' }`; a second rescan of the same collection still resolves `RESCAN_IN_PROGRESS`; a rescan of a different collection is not blocked.
**Depends on:** 15, 21
**Estimate:** 3
**Notes:** Covers FR-12 and FR-13 (in-flight refusals end to end). The disabled state follows `collection-busy-changed` and `collection-selected`; busy is begun by the rescan button (Task 15) and by the panel's add-folder (Task 19). The main-process refusal is the authority; the disabled controls are the renderer half.
**POS:** task_06d4ebbd
**Done:** [ ]

### Task 24: E2E switching the active collection
**What:** Add an e2e of switching between collections: only the chosen collection's files are shown, no selection carries over, and nothing is scanned.
**Files:** tests/e2e/collection-switch.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/collection-switch.spec.js` exits 0, with a test that creates two collections over different fixture folders before launch, launches, and asserts: at launch no collection item has `collection-selected` and the tree has no rows; clicking the first shows only its files (every `tree-row` `data-path` is under its folders, none under the other's); clicking the second shows only the second's files and none of the first's; a file selected in the first is not selected after switching (no `aria-selected="true"`, empty file detail, Reveal disabled), and switching back does not restore it; the number of `collections:rescan` calls (counted through `gateChannel` or an `ipc-wrap` counter) is zero across the switches and the store file bytes are identical before and after; after relaunch no collection is selected (the active collection is not persisted).
**Depends on:** none
**Estimate:** 2
**Notes:** Covers FR-5 and FR-13. The switching code already exists in `create-collection.js` (`selectCollection`); this task is the test, and fixes a defect only if the test shows one. Spec-only task. Create the collections through `createCollectionService` against `openStorage` before launch, as `rescan.spec.js` does.
**POS:** task_b8c255eb
**Done:** [x]

### Task 25: E2E the same folder in several collections
**What:** Add an e2e that puts one folder into two collections through the UI and checks that each keeps its own records through add, remove, delete and relaunch.
**Files:** tests/e2e/shared-folder.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/shared-folder.spec.js` exits 0, with a test that creates collection A over folder X, creates collection B over folder Y, adds X to B through the panel with `stubFolderPicker`, and asserts: the store (read after closing) has two folder records with the same path, different ids and different `collectionId`, each with its own index; a file created in X on disk then rescanning A updates A's tree only, and B keeps the old copy until B is rescanned (the copies differ, as the spec states); removing X from B leaves A's folder record, index and tree identical (JSON compared); adding X to B again and deleting A (confirm true) leaves B's folder and files intact after relaunch; the files on disk in X are unchanged throughout.
**Depends on:** 17, 19, 21
**Estimate:** 3
**Notes:** Covers FR-6, FR-4 (other collection untouched, end to end) and FR-13. Use a copy of the fixture tree so the disk change does not leak into other specs.
**POS:** task_146d9736
**Done:** [ ]

### Task 26: E2E one appearance of a file across overlapping roots
**What:** Add an e2e that builds overlapping roots through the UI and asserts a file shows once, selection identifies one row, and removing the outer root moves the files to the inner root.
**Files:** tests/e2e/dedup.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/dedup.spec.js` exits 0, with tests asserting: (inside) a collection with root R and its subfolder S added with confirm true shows each file under S once (counting rows with that `data-path` after expanding both roots gives 1), the S root row is still present; (contains) a collection with S first and then R added (confirm true) shows the same single appearance, and the file's row is under R; (identical) the same path added twice (confirm true) shows each file once, under the earlier-added root; clicking a file selects exactly one row and `file-detail` shows its path once; after a Rescan, after a relaunch and after adding another unrelated folder the single appearance still holds; removing the outer root makes the files appear under the inner root, with the selection kept only if its node id still exists, otherwise cleared with the empty detail state; the store holds no change from the dedup (folder records and index records are the same set as before removing).
**Depends on:** 11, 17, 19
**Estimate:** 3
**Notes:** Covers FR-9 and FR-13 (e2e). Expanding the roots uses the existing tree interactions in `tree-view.spec.js`. Spec-only task.
**POS:** task_0867bb8a
**Done:** [ ]

### Task 27: Read-only check around every management flow
**What:** Add an e2e that snapshots a fixture tree with `tools/readonly-check` before and after rename, delete, add, remove, switch and a cancelled add, and asserts no differences.
**Files:** tests/e2e/management-readonly.spec.js
**Done when:** `npm run test:e2e -- tests/e2e/management-readonly.spec.js` exits 0, with a test that builds the fixture tree, creates two collections over it (one with two folders), takes `snapshot(root)` with the app closed, launches, performs rename, switch, add folder (confirm true, overlapping), a cancelled add (confirm false), remove folder, a creation with overlapping folders (confirm true) and delete of a collection, closes the app, takes a second snapshot, and `assert(compare(before, after))` passes with no non-atime differences (content hash, mtime, ctime, birthtime, mode, extended attributes), the atime difference, if any, printed in the test output; a second test runs the same sequence with every confirmation cancelled and asserts the same; each flow was confirmed to run (the test asserts the collection list and tree reflect each completed step).
**Depends on:** 18, 20, 21, 22
**Estimate:** 3
**Notes:** Covers FR-10 and US-3. Follow `tests/e2e/reveal-readonly.spec.js` for the snapshot pattern: both snapshots are taken with the app closed to keep the ordering rule of `tools/readonly-check`. The store lives in the user data dir, outside the fixture tree.
**POS:** task_086ec0b3
**Done:** [ ]

## Summary
- Total tasks: 27
- Total estimated effort: 75
- Parallel waves: (1) Tasks 1, 2, 4, 5, 15, 24; (2) Tasks 3, 6; (3) Task 7; (4) Task 8; (5) Tasks 9, 13; (6) Tasks 10, 12; (7) Tasks 11, 14; (8) Task 16; (9) Task 17; (10) Tasks 18, 19; (11) Tasks 20, 21, 26; (12) Tasks 22, 23, 25; (13) Task 27. Same-file conflicts: Tasks 6 to 10 all edit `src/main/collections/service.js` and its test file (serial); Tasks 4 and 12 edit `main.js`; Tasks 12 edits `ipc.js` and `preload.js` alone; Tasks 11, 15, 16, 17, 19 and 21 edit `src/renderer/index.html`; Tasks 16, 17, 19, 21 and 23 edit `collection-manage.js`; Tasks 16, 21 and 22 edit `create-collection.js`; Tasks 2, 3, 4, 5, 15 and 16 each add a line to the `build` script in `package.json` (a one-line merge). Tasks 18, 20, 24, 25, 26, 27 only add e2e spec files.
- Critical path: Tasks 1 → 6 → 7 → 8 → 9 → 12 → 14 → 16 → 17 → 19 → 21 → 22 → 27 (39 points)
- Risks: Task 8 is the largest and carries the most logic (validation reuse, overlap, confirmation, guard timing, transaction); the guard must be held before the confirmation so a rescan cannot interleave. Task 14 depends on a `dialog` proxy in `background-main.js`; the existing picker stub assigns on the real module through `app.evaluate`, so the proxy must forward every other key or the picker stub stops working. Task 11 adds a rule the spec does not state (an inner root keeps a file the owning root has no record of); if the product owner wants strict outer-root ownership, only that condition changes. Task 10 makes the renderer rely on a derived `resolvedPath`; symlinked roots are de-duplicated only through it. Task 13 depends on a fixture generated from the pre-feature commit; generate it before Task 1 is merged or from the recorded commit. Task 19/20 `chmod` and symlink cases depend on the sandbox permitting them and are skipped with a stated reason otherwise. Real v1 stores may have a stale `folderIds`, so ordering code must not assume it is complete (Task 10, Task 13).
- FR coverage: FR-1 (6, 12, 16), FR-2 (7, 12, 14, 21), FR-3 (6, 12, 17, 18), FR-4 (1, 6, 7, 8, 21, 25), FR-5 (24), FR-6 (1, 8, 9, 10, 13, 25), FR-7 (8, 12, 19), FR-8 (2, 3, 5, 8, 9, 20, 22), FR-9 (2, 10, 11, 26), FR-10 (27), FR-11 (1, 6, 7, 8, 12, 13), FR-12 (4, 6, 7, 8, 15, 23), FR-13 (1, 3, 4, 6, 7, 8, 11, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26)

## Open Questions
None.
