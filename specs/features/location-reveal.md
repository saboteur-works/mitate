# Feature Spec: File location and Reveal in Finder

**Source:** Feature 2 in `specs/product/media-organizer-mvp.features.md`
**Product spec:** `specs/product/media-organizer-mvp.md` (product FR-15, FR-16, FR-17; product US-6; Constraints: read-only, macOS first)
**Branch:** `feat/location-reveal`
**Depends on:** Feature 1 (`specs/features/collection-index-tree.md`, shipped). IDs below are local to this document. Each requirement names the product requirement it implements.

## Overview
A user who has found a file in the collection tree can see where it lives on disk and open that location in Finder with the file selected, so the file can be used in other apps. Feature 1 shows file names and the tree but no path, and nothing in the tree can be selected as a file. This feature adds the minimum file selection needed to have a "selected file", a display of its full absolute path, and a "Reveal in Finder" action. It does not change any file.

## State of the shipped code (measured by reading the code, 2026-10-20)
- `src/renderer/tree-view.js`: each row is a `div` with `data-node-id` and `data-path` (absolute path) and `role="treeitem"`. Only folder rows have a click handler (expand or collapse). File rows have no click handler, no selected state and no keyboard handling. There is no notion of a selected file.
- `src/shared/tree-model.js`: file nodes carry the absolute `path`, `name` and `unavailable`; node ids are `<rootFolderId>:<relativePath>`.
- `FileRecord.path` in storage is the absolute path; a file in an unavailable folder carries `unavailable: true` (FR-4 of Feature 1).
- `src/main/ipc.js` has five channels (`folders:pick`, `collections:create`, `collections:list`, `collections:getView`, `collections:rescan`), a `guard` wrapper returning `{ ok, error, code }`, and `registerIpc`; `src/main/preload.js` exposes the matching methods on `window.mediaOrganizer`. There is no reveal channel.
- The e2e tests run the app hidden through `tests/support/background-main.js` and can wrap a main-process handler with `tests/support/ipc-wrap.js`.

## Goals
- A user can select a file in the tree, and exactly one file is selected at a time.
- The full absolute path of the selected file is visible without truncating it away.
- A "Reveal in Finder" action opens a Finder window with the selected file selected.
- Selecting and revealing change nothing inside a collection's folders.
- The reveal can be tested end to end without bringing Finder to the front.

## Non-goals
- Copy path, open in the default app, drag out of the app, or any other file action (copy path and open in the default app are deferred: see OQ-3 and OQ-4).
- Preview or playback of the selected file (Features 6 to 8).
- Multi-select, and revealing several files at once.
- Reveal on Windows or Linux (post-v2); only the Reveal action may assume macOS.
- Rename, move, delete or any change to files (product FR-17).

## User stories
- US-1: As a hobbyist, I want to see where a file lives and reveal it in Finder so that I can work with it in other apps. (Product US-6.)
- US-2: As a creative professional, I want to be sure that looking at a file's location never changes it so that I can point the app at irreplaceable archives. (Product US-3.)

## Functional requirements
1. FR-1: Users MUST be able to select a file by clicking its row in the tree. Exactly one file MUST be selected at a time, the selected row MUST show a visible selected state, and selecting a file MUST NOT expand, collapse or reorder anything. The selection MUST be identified by the node id (`<rootFolderId>:<relativePath>`), not by absolute path, because overlapping roots can show the same path twice. [US-1] (Supports product FR-15, FR-16.)
2. FR-2: Users MUST be able to select a file and operate the reveal action using the keyboard alone. The tree MUST be reachable by Tab, the user MUST be able to move the selection between visible rows, and the reveal action MUST be a focusable control that activates with Enter or Space. The key bindings are: the tree is a single Tab stop; Up and Down arrows move the focus between visible rows, and the arrows land on both file rows and folder rows; Enter or Space on a file row selects it; Enter or Space on a folder row expands or collapses it (FR-11); the Reveal action is a normal button reached by Tab and activated by Enter or Space. There MUST be no global keyboard shortcut for Reveal. [US-1] (Supports product FR-15, FR-16.)
3. FR-3: When a file is selected, the app MUST display its full absolute path, exactly as stored in the file record's `path`. The display MUST update when the selection changes. [US-1] (Product FR-15.)
4. FR-4: A path longer than the available width MUST NOT be cut off without the full text remaining available: the full path MUST be present as text in the page, so that an automated test can read it, and its visible form MUST wrap (for example with `overflow-wrap: anywhere`) so the user can read every character without scrolling. The path text MUST be selectable with the mouse. Truncation with an ellipsis and a tooltip-only form are not allowed. [US-1] (Product FR-15.)
5. FR-5: When no file is selected, the path display MUST show an empty state and the "Reveal in Finder" action MUST be disabled. When the selection is cleared by a rescan that removes the file, the same empty state MUST apply (see FR-12). [US-1] (Product FR-15, FR-16.)
6. FR-6: The app MUST provide a "Reveal in Finder" action, labelled exactly "Reveal in Finder", enabled when a file is selected (FR-5). Activating it MUST ask the main process to reveal the selected file's absolute path. The renderer MUST send the node id or path of a file the app has indexed; the main process MUST reveal only a path that belongs to a stored file record, and MUST reject any other path with an error. [US-1] (Product FR-16.)
7. FR-7: The reveal MUST open a Finder window with the file selected, using the operating system's reveal-in-file-manager function for that path. The action is macOS-only; the rest of this feature (FR-1 to FR-5) MUST NOT depend on macOS. [US-1] (Product FR-16; Constraint: platform.)
8. FR-8: Reveal MUST use the same IPC conventions as the existing channels: one new channel name defined in `src/main/ipc.js` and mirrored in `src/main/preload.js`, results returned as `{ ok: true }` or `{ ok: false, error }` through `guard`, and the call wrapped in a thin main-process function that e2e tests can replace (FR-13). [US-1] (Supports product FR-16.)
9. FR-9: If the selected file no longer exists on disk when the reveal is requested (deleted or moved since indexing), the app MUST NOT reveal anything, MUST show an error naming the file's path, and MUST NOT remove or alter the stored file record. The stored index keeps showing the file until a rescan (Feature 1 FR-20). The app MUST NOT reveal the parent folder instead and MUST NOT offer a rescan action from the error. [US-1] (Product FR-16.)
10. FR-10: A file marked "unavailable" (its folder cannot be read) MUST still be selectable and its stored path MUST still be displayed. The reveal action for such a file MUST behave as FR-9 when the file cannot be found, and MUST otherwise reveal it. The row MUST keep showing its "unavailable" label. [US-1] (Product FR-15, FR-16; Feature 1 FR-4.)
11. FR-11: Folder rows MUST keep their existing behaviour (click expands or collapses). Selecting a folder MUST NOT select a file, MUST NOT enable the reveal action, and MUST NOT change the displayed path. The path display and the reveal action apply to files only; this includes a collection's root folders. [US-1] (Product FR-15, FR-16 name "selected file".)
12. FR-12: After a rescan, or after the tree is otherwise refreshed with the same data, the selection MUST be kept if the file's node id still exists. If it no longer exists, the selection MUST be cleared (FR-5). [US-1] (Product FR-15.)
13. FR-13: Reveal MUST NOT create, modify, move, rename or delete any file, folder or extended attribute inside a collection's folders. Selecting a file and displaying its path MUST NOT read the file's contents. Tests MUST run the Feature 1 read-only check (`tools/readonly-check`) around select and reveal on a fixture tree, with the reveal call stubbed, and the check MUST report no differences. [US-2] (Product FR-17.)
14. FR-14: End-to-end tests MUST NOT perform a real reveal. They MUST replace the main-process reveal function (FR-8) using `tests/support/ipc-wrap.js` or an equivalent test hook, record the path it receives, and assert that path equals the selected file's absolute path. They MUST run through `tests/support/background-main.js`, so no window or Finder is brought to the front. [US-1] (Product FR-16; repository e2e convention.)
15. FR-15: The real reveal MUST be verified by a recorded hands-on check on macOS: select a file in the running app, activate "Reveal in Finder", and confirm that Finder shows the file's folder with the file selected. The check MUST be run once for a file on the internal drive and once for a file on an external or network volume, and its outcome (pass or fail, per volume) MUST be written in the repository. [US-1] (Product FR-16.)
16. FR-16: Unit tests MUST cover: the path display for a short and a very long path (for example over 300 characters), the disabled state with no selection, rejection of a path that is not in the index (FR-6), and the not-found case (FR-9) with the file-system check replaced. [US-1] (Product FR-15, FR-16.)

## Open questions
- OQ-1 [Resolved 2026-10-20]: Is a long path shown in full (wrapped or scrolled, as FR-4 requires), or may it be shortened in the middle with the full path in a tooltip? — Impact: FR-4, FR-16. Owner: product owner (user).
  Answer: Long paths are shown in full, wrapped and selectable. No ellipsis truncation and no tooltip-only form (FR-4).
- OQ-2 [Resolved 2026-10-20]: When the file is missing at reveal time, should the app only show an error (as FR-9 requires), or reveal the nearest existing parent folder, or offer a rescan? — Impact: FR-9, FR-10, FR-16. Owner: product owner (user).
  Answer: Error naming the path, nothing revealed, record untouched (FR-9). No parent-folder reveal and no rescan button. Revisit once live updates exist in v1.
- OQ-3 [Resolved 2026-10-20]: Is "copy path" wanted? It is not in the product spec, and the path text is selectable (FR-4), which allows copying by hand. A button would add scope. — Impact: FR-3, FR-4, Non-goals. Owner: product owner (user).
  Answer: No Copy path button; deferred, with no milestone assigned. The path text stays selectable for manual copy (FR-4).
- OQ-4 [Resolved 2026-10-20]: Is "open in the default app" wanted in this MVP? It is not in the product spec. — Impact: Non-goals, Out of scope. Owner: product owner (user).
  Answer: No "Open in default app"; deferred, with no milestone assigned. Reason: another app could modify or lock the file, which touches the read-only promise (product FR-17). Also listed in the product spec's Out of Scope (Deferred).
- OQ-5 [Resolved 2026-10-20]: Which keys move the selection between file rows (arrow keys across the whole tree, or arrow keys plus type-ahead), and is there a shortcut for Reveal (for example Cmd+R)? — Impact: FR-2, FR-1. Owner: product owner (user), with the implementer for conflicts with macOS shortcuts.
  Answer: The tree is a single Tab stop. Up and Down arrows move between visible file and folder rows. Enter or Space selects a focused file and toggles a focused folder (FR-11). Reveal is a normal button reached by Tab and activated by Enter or Space. No global shortcut. Revisit shortcuts and type-ahead after Features 4 and 6 settle layout (FR-2).
- OQ-6 [Resolved 2026-10-20]: Do the path display and Reveal in Finder also apply to folder rows (including the collection's root folders)? The product requirements name only "the selected file". Revealing an unavailable root folder would behave as FR-9. — Impact: FR-11, FR-5, FR-6. Owner: product owner (user).
  Answer: Confirmed. Path display and Reveal apply to files only; folder rows, including roots, keep expand/collapse and never enable Reveal (FR-11).
- OQ-7 [Resolved 2026-10-20]: Where does the path display sit in the window (below the tree, or in a side pane shared later with the preview pane of Features 6 to 8)? — Impact: FR-3, FR-4, and the layout of Features 6 to 8. Owner: product owner (user).
  Answer: Confirmed. The path display and Reveal button sit in a detail area below the tree; Feature 6 may relocate them into its preview pane later.
- OQ-8 [Resolved 2026-10-20]: Should the same file appearing twice under overlapping roots (until Feature 3 de-duplicates it) show the selected state on both rows, or only on the clicked row? FR-1 currently selects by node id, so only the clicked row. — Impact: FR-1, FR-12. Owner: product owner (user).
  Answer: Confirmed. Only the clicked row shows selected (selection keyed by node id, FR-1). Duplicates go away with Feature 3.
- OQ-9 [Resolved 2026-10-20]: What does the hands-on check (FR-15) record for a network volume if Finder cannot select the file there? Not measured; the check is the experiment that settles it. — Impact: FR-15, FR-7. Owner: implementer.
  Answer: Confirmed. The hands-on check records the observed outcome per volume (pass or fail, and what Finder showed) and names no cause (FR-15).

## Out of scope (deferred)
- Copy path (OQ-3) and open in default app (OQ-4), deferred with no milestone assigned.
- Revealing from the flat type views (Feature 4), which show files differently and are built separately.
- Showing the path of files in search results or from the preview pane (Features 6 to 8).
- Reveal equivalents on Windows and Linux (post-v2).
- Live detection that a file was deleted or moved (v1); only a rescan refreshes the index.
