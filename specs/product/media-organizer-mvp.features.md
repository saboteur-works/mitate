# Feature Breakdown: Media Organizer — MVP

**Source spec:** `specs/product/media-organizer-mvp.md`
**Milestone scope:** MVP

FR-12 and FR-14 each cover several format groups, so this breakdown splits them by sub-part. Each sub-part belongs to exactly one feature, as the coverage check shows.

### Feature 1: Index a folder collection and browse its tree
**Value:** A user creates a collection from one or more folders and browses every supported media file in them as a folder tree. The collection is still there after a restart.
**Vertical slice:**
- **data:** collection and folder records, a file index, and folder-access persistence, all in app storage;
- **logic:** recursive discovery, with hidden files, package contents and symlinks skipped, and a supported-type registry;
- **interface:** a folder picker, a collection with a name, and a tree view.

**Requirements covered:** FR-1, FR-7, FR-8, FR-9, FR-10, FR-17
**User stories:** US-1, US-3
**Depends on:** none
**Branch suggestion:** feat/collection-index-tree
**Notes:**
- **The supported-type registry is defined here.** It is the list of extensions and media kinds that FR-8 indexes and FR-14 treats as known. The view and preview features read it.
- **FR-17, read-only, is assigned here** because this feature sets up app storage. It needs a reusable before/after check of contents, timestamps and extended attributes. Every later feature must also pass that check.
- **FR-7 depends on the distribution channel.** Folder access that survives a restart works differently inside the App Store sandbox and outside it.
- **Duplicates may show until Feature 3 ships.** If a single collection has overlapping folders, files can appear twice, because FR-6 is in Feature 3.

### Feature 2: File location and Reveal in Finder
**Value:** A user selects any file and sees its full path, then opens it in Finder in one action.
**Vertical slice:**
- **logic:** path resolution and a call to reveal the file in Finder;
- **interface:** a path display and a "Reveal in Finder" action on the selected file.

**Requirements covered:** FR-15, FR-16
**User stories:** US-6
**Depends on:** 1
**Branch suggestion:** feat/location-reveal

### Feature 3: Manage and switch between collections
**Value:** A user keeps several named collections, which may share folders, switches between them, and edits them, without anything changing on disk.
**Vertical slice:**
- **data:** many collections, and many-to-many links between collections and folders;
- **logic:** switching the active collection, detecting overlapping folders, and showing each file only once;
- **interface:** a collection switcher, rename and delete, removing a folder, and a confirmation when adding a nested folder.

**Requirements covered:** FR-2, FR-3, FR-4, FR-5, FR-6
**User stories:** US-1, US-2, US-3
**Depends on:** 1
**Branch suggestion:** feat/collection-management
**Notes:**
- **OQ-6 is open.** It asks what happens when a user adds a folder that *contains* a folder already in the collection. It affects FR-5 and FR-6, so the product designer should answer it before this feature is broken into tasks.
- **Deleting a collection or removing a folder** must delete index and cache entries that no other collection still uses (FR-2, FR-4).

### Feature 4: Browse by media type
**Value:** A user browses flat Images, Audio, Video and Documents lists that span every folder in the active collection.
**Vertical slice:**
- **logic:** queries the index by media kind;
- **interface:** four type views alongside the tree view.

**Requirements covered:** FR-11
**User stories:** US-5
**Depends on:** 1
**Branch suggestion:** feat/type-views
**Notes:** **Scale.** Flat lists over hundreds of thousands of files are the primary audience's normal case, so the list must be virtualized from the start.

### Feature 5: Scan progress and browsing during a scan
**Value:** A user starts browsing as soon as the first files are found. They see a running count of files found until the scan finishes.
**Vertical slice:**
- **logic:** an incremental scan that publishes results as it goes, plus progress events;
- **interface:** a progress indicator and views that update while the scan runs.

**Requirements covered:** FR-18, FR-19
**User stories:** US-1
**Depends on:** 1
**Branch suggestion:** feat/scan-progress
**Notes:**
- **Where incremental publishing lives is open.** If Feature 1's scan already publishes as it goes, this feature shrinks to the progress interface. That is decided when the tasks are broken down.
- **Feature 4 must stay correct during a scan.** Its views update while this feature's scan runs.

### Feature 6: Image and document preview
**Value:** A photographer previews any MVP image format in the app, including HEIC, PSD and RAW at full embedded resolution. PDFs and text files open too. Files the app can't show say so plainly.
**Vertical slice:**
- **logic:**
  - Chromium decodes the web-native formats.
  - Quick Look (`createThumbnailFromPath`) handles heic, tiff, psd, exr and tga, for the allowlisted types only.
  - The embedded JPEG is extracted from RAW files.
  - Generated previews are written to the app-storage cache.
- **interface:** a preview pane, and a "preview not available" state.

**Requirements covered:**
- FR-12, image formats: jpeg, png, gif, heic/heif, tiff, bmp, webp, avif, psd, exr, tga;
- FR-12, RAW formats;
- FR-12, documents: pdf, txt;
- FR-12, the resolution clause;
- FR-14, unpreviewable and failed files.

**User stories:** US-4, US-5
**Depends on:** 1
**Branch suggestion:** feat/image-document-preview
**Notes:**
- **Quick Look fails silently.** It returns a generic icon without an error for types it can't render, so it must only be called for allowlisted types.
- **RAW coverage is partly tested.** Only cr3, nef, arw, dng and raf were tested, so a RAW file with no embedded JPEG must fall through to the FR-14 state.
- **OQ-3, the cache size limit,** and **OQ-5, cache protection,** apply to the preview cache.
- **This feature creates the preview pane** that Feature 7 reuses.

### Feature 7: Audio and video playback (Electron-native formats)
**Value:** A user plays audio and video in the formats Electron decodes, with play/pause, seek and volume. A video that's missing its picture or sound says so instead of playing silently or blank.
**Vertical slice:**
- **logic:**
  - an HTML media element;
  - a decode check that confirms decoded frames and audio bytes, not just the load event.
- **interface:** a player in the preview pane.

**Requirements covered:**
- FR-12, video: mp4, mov, m4v, 3gp, mkv, webm, when the codec is H.264, HEVC, AV1, VP8 or VP9;
- FR-12, audio: mp3, aac/m4a, wav, flac, ogg, opus;
- FR-13;
- FR-14, missing picture or sound.

**User stories:** US-4
**Depends on:** 1, 6
**Branch suggestion:** feat/av-playback
**Notes:** **Decode failures are measured.** Video whose audio is AC-3, E-AC-3 or ALAC plays silently, and ProRes 422 plays sound with no picture. The decode check exists because of these cases.

### Feature 8: Playback of macOS-only formats through conversion
**Value:** A video editor plays ProRes, MPEG-2 and DV clips, and anyone can play AIFF audio. The app converts each file into app storage, and the original is never touched.
**Vertical slice:**
- **logic:**
  - `avconvert` conversion to H.264 in segments;
  - AIFF-to-WAV conversion in the app;
  - cache management.
- **interface:** a "preparing" state, then the Feature 7 player.

**Requirements covered:** FR-12, the converted formats: ProRes in mov, mpg and dv video, and aiff audio.
**User stories:** US-4
**Depends on:** 7
**Branch suggestion:** feat/converted-playback
**Notes:**
- **Most of this format work is unmeasured or untested.**
  - Conversion has only been measured on ProRes, with source files probably read from memory.
  - `avconvert` is untested on mpg and dv.
  - Smooth segmented playback and speed from external drives are part of OQ-2.
- **This is the riskiest MVP feature.**
- **OQ-3, the disk limit,** decides the cache eviction rules here.

## Coverage check
- **Requirements covered:**

  | Requirement | Feature |
  |---|---|
  | FR-1 | 1 |
  | FR-2 | 3 |
  | FR-3 | 3 |
  | FR-4 | 3 |
  | FR-5 | 3 |
  | FR-6 | 3 |
  | FR-7 | 1 |
  | FR-8 | 1 |
  | FR-9 | 1 |
  | FR-10 | 1 |
  | FR-11 | 4 |
  | FR-12, images, RAW, documents and the resolution clause | 6 |
  | FR-12, Electron-native video and audio | 7 |
  | FR-12, ProRes, mpg, dv and aiff | 8 |
  | FR-13 | 7 |
  | FR-14, unpreviewable and failed files | 6 |
  | FR-14, missing picture or sound | 7 |
  | FR-15 | 2 |
  | FR-16 | 2 |
  | FR-17 | 1 |
  | FR-18 | 5 |
  | FR-19 | 5 |

- **Unassigned requirements:**
  - **FR-20, numeric performance targets.** Blocked by OQ-1. It's a target across Features 1, 4 and 5 rather than a slice of its own. Attach its acceptance criteria to those features once the targets exist.
  - **FR-12, the formats pending OQ-2:** jxl, alac, caf, ac3, and playback of ts, mts and m2ts. Blocked. Once OQ-2 answers how they're handled, they will likely fall into Feature 7 or 8.

## Summary
- **Total features:** 8
- **Suggested build order:** 1, then 2, 3, 4, 5 and 6 in parallel, then 7, then 8.
- **Independently shippable:** Feature 1 has no dependencies. Features 2–6 each depend only on Feature 1.
- **Risks:**
  - **Feature 8 has the most unmeasured work:** conversion of non-ProRes formats, segment playback, external-drive speed, and the cache limit.
  - **Feature 3 is waiting on OQ-6.**
  - **FR-17 spans every feature.** It's assigned to Feature 1, but every later feature can break it. The read-only check from Feature 1 should run in every feature's tests.
  - **Features 1 and 5 share a boundary:** how incremental the scan is.
  - **Features 6 and 7 share the preview pane.**
