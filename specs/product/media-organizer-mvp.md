# Product Spec: Media Organizer — MVP

**Milestone scope:** MVP
**Status:** Draft
**Source concept:** Media Organizer (working title), `docs/concept.md`
**Other milestones:** `media-organizer-v1.md`, `media-organizer-v2.md`

## Overview
Media Organizer is a read-only desktop app, macOS first. It gives users one place to browse and play media spread across folders, external drives and network shares.

Existing tools either show one folder at a time (Finder) or import files into a managed library (Photos, Lightroom, Eagle). This app indexes folders where they already are:
- Users group folders into named collections and switch between them.
- Within a collection, they browse by the original folder tree or by media type.
- They view and play files in the app.
- They see each file's real location and can reveal it in Finder in one step.

The app never moves, renames, edits or deletes a file.

## Goals
- A user can see every supported media file across several folders and drives in one collection view.
- A user can preview or play every MVP format without leaving the app.
- A user can go from any file in the app to that file in Finder in one action.
- The product leaves every file and folder in a collection byte-for-byte and attribute-for-attribute unchanged.
- A user can browse a collection while its first scan is still running.

## Non-goals
- **File management:** no moving, renaming, copying, deleting or creating files.
- **Editing:** no cropping, trimming or writing metadata to files, and no exporting converted copies. Converting a file into app storage only to play it is not editing (see Resolved decisions).
- **Importing:** files are never copied into a managed library.
- **Adding individual files:** only folders can be added.
- **Sync or backup.**
- **Windows and Linux desktop releases.**
- **Everything in the v1 and v2 specs**, including search, filters, tags, live index updates and metadata display.

## Users

**Creative professional**
A photographer, musician, video editor or designer with an archive of hundreds of thousands of files, often on external drives or a NAS.
**Key need:** Browse and play a deliberately organized archive across drives without any tool reorganizing it.
**Success looks like:** They stop opening Finder windows one at a time to find media, and they trust the app on irreplaceable archives.

**Hobbyist / personal user**
Someone with thousands to tens of thousands of files across a few folders and drives.
**Key need:** One place to browse and play everything.
**Success looks like:** They find and play any photo, song or video from one window.

## User Stories

*Creative professional*
- US-1: As a creative professional, I want to group folders from different drives into named collections so that each project or archive has its own workspace. [MVP]
- US-2: As a creative professional, I want to switch between collections so that I only see the media relevant to the current job. [MVP]
- US-3: As a creative professional, I want a guarantee that the app never changes my files so that I can point it at irreplaceable archives. [MVP]
- US-4: As a creative professional, I want to preview RAW, HEIC, TIFF and ProRes files in the app so that I don't need a separate viewer for each format. [MVP]

*Hobbyist / personal user*
- US-5: As a hobbyist, I want to see all my images, audio, video and documents as flat lists by type so that the folder structure doesn't get in the way. [MVP]
- US-6: As a hobbyist, I want to see where a file lives and reveal it in Finder so that I can work with it in other apps. [MVP]

## Functional Requirements

### MVP Requirements
- FR-1: Users MUST be able to create a named collection by adding one or more folders through a folder picker. Adding individual files MUST NOT be possible. [US-1]
- FR-2: Users MUST be able to rename a collection, delete a collection, and remove a folder from a collection. None of these actions may change anything on disk. [US-1, US-3]
- FR-3: Users MUST be able to switch the active collection. All views MUST then show only files from that collection's folders. [US-2]
- FR-4: The same folder MUST be allowed in more than one collection. [US-1]
- FR-5: When a user adds a folder that sits inside a folder already in the collection, the app MUST tell them it is already covered and require confirmation. If the user cancels, the collection MUST be left unchanged. [US-1]
- FR-6: A file reachable through more than one folder in the same collection MUST appear once. [US-5]
- FR-7: Collections and folder access MUST persist across app restarts without the user re-selecting folders. [US-1]
- FR-8: The app MUST index files of supported media types in each folder and all its subfolders, at any depth. [US-5]
- FR-9: The app MUST skip hidden files and folders. It MUST NOT index the contents of package bundles (e.g. .app, .photoslibrary) and MUST NOT follow symlinks. [US-5]
- FR-10: Users MUST be able to browse a collection as a folder tree that mirrors the on-disk structure. [US-1]
- FR-11: Users MUST be able to browse flat Images, Audio, Video and Documents views that span every folder in the collection. [US-5]
- FR-12: Users MUST be able to preview or play these formats in the app. [US-4]
  - **Images:** jpeg, png, gif, heic/heif, tiff, bmp, webp, avif, psd, exr, tga.
  - **RAW:** cr2, cr3, nef, arw, dng, raf, orf, rw2, pef, srw, iiq, 3fr. Only cr3, nef, arw, dng and raf have been tested.
  - **Video:** mp4, mov, m4v, 3gp, mkv, webm, mpg, dv.
  - **Audio:** mp3, aac/m4a, wav, aiff, flac, ogg, opus.
  - **Documents:** pdf, txt.
  - **Resolution:** previews of heic, tiff, psd, exr and tga MAY be limited to 2048 px on the long edge. RAW MUST be viewable at the resolution of its embedded preview.
  - **Pending OQ-2:** jxl, alac, caf, ac3, and playback of ts/mts/m2ts. [BLOCKED: OQ-2, for these formats only]
- FR-13: Audio and video playback MUST provide play/pause, seek and volume. [US-4]
- FR-14: Known media types without a preview (e.g. wmv, wma, avi, flv, epub, cbz), and supported-extension files that fail to decode, MUST still be indexed and MUST show "preview not available" without an error. A video whose picture or sound doesn't decode MUST say which is missing, not play silently or blank. [US-5]
- FR-15: The full absolute path of the selected file MUST be visible. [US-6]
- FR-16: A "Reveal in Finder" action MUST open a Finder window with the file selected. [US-6]
- FR-17: The app MUST NOT create, modify, move, rename or delete any file, folder or extended attribute inside a collection's folders. This is verifiable by comparing contents, timestamps and extended attributes before and after use. [US-3]
- FR-18: Users MUST be able to browse already-discovered files while a scan is running. [US-1]
- FR-19: The app MUST show scan progress, including a running count of files found. [US-1]
- FR-20: Scanning and browsing MUST meet numeric performance targets. [BLOCKED: OQ-1]

## Constraints
- **Platform.** Desktop ships on macOS first. Requirements other than "Reveal in Finder" SHOULD NOT assume macOS, because Windows and Linux follow. The MVP format handling relies on macOS tools, so each later platform needs its own (OQ-2).
- **Runtime.** The desktop runtime is Electron. The accepted format approach is built on it. Electron alone doesn't meet FR-12, but Electron plus macOS's built-in tools does for the formats not pending OQ-2 (`docs/research/format-support.md`).
- **Read-only.** This applies to all user files, including extended attributes. The app's index, thumbnails, converted playback copies and user data MUST live in app storage, never alongside the user's files.
- **Folder access.** It must survive restarts (FR-7) under the chosen distribution channel. App Store sandboxing restricts this.
- **Scale.** Large archives on external drives and NAS volumes are the primary audience's normal case, not an edge case.
- **Privacy.** The index, thumbnail cache and converted playback copies hold copies of private media. How they are protected is a product decision (OQ-5).
- **Offline.** Core features MUST work without a network connection.

## Open Questions

**OQ-1: What numeric targets apply to first results, full scan time and browsing responsiveness?**
They are to be set after measuring Finder, Bridge and NeoFinder on a reference set of files.
**Impact:** FR-20. The v1 spec's live index updates depend on the same targets.
**Owner:** Product owner with engineering lead

**OQ-2: How are the formats left open by the format decision handled?**
The open items:
- jxl;
- playback of alac, caf and ac3, including as audio tracks inside video;
- playback of ts, mts and m2ts;
- heic, tiff and psd above 2048 px;
- conversion speed from external drives and NAS volumes;
- smooth playback of segmented conversion;
- Windows and Linux.

**Impact:** FR-12 (pending formats only), FR-14, the platform constraint.
**Owner:** Engineering lead

**OQ-3: How much disk may converted playback copies and thumbnails use, and what happens at the limit?**
A converted 30 s 1080p ProRes clip measured 34–40 MB, so a large ProRes archive could fill a disk.
**Impact:** FR-12, the read-only storage constraint.
**Owner:** Product owner with engineering lead

**OQ-4: Are third-party decoders (wmv, wma, avi, flv, DNxHD) ever in scope, or do these formats stay index-only?**
Neither Electron nor macOS decodes them (measured 2026-10-18).
**Impact:** FR-14.
**Owner:** Product owner

**OQ-5: Is encryption offered, and what is free vs. paid (encrypted thumbnail cache, app lock, locked collections)?**
**Impact:** The privacy constraint. It may add requirements.
**Owner:** Product owner

**OQ-6: What happens when a user adds a folder that contains a folder already in the collection?**
FR-5 covers only the reverse case.
**Impact:** FR-5, FR-6.
**Owner:** Product designer

## Out of Scope (Deferred)
- [v1] Search, filters, tags, live index updates, more preview types, opt-in hidden files, packages and symlinks, and metadata display (`media-organizer-v1.md`).
- [v2] Content search, smart collections, an offline-drive catalog, a duplicate report and a paid mobile app (`media-organizer-v2.md`).
- [post-v2] Windows and Linux desktop releases.
- [post-v2] Third-party decoders, pending OQ-4.
- [post-v2] Adding individual files to a collection.

## Resolved decisions (2026-10-18)
- **Packages and symlinks:** package bundles and symlinks are skipped in MVP (FR-9), with an opt-in in v1.
- **Performance:** it is specified as behavior in MVP (FR-18, FR-19). Numeric targets follow measurement (OQ-1).
- **Formats Electron can't decode** are handled with macOS's built-in tools, with no bundled decoders and no native code. This makes Electron the desktop runtime. Measurements are in `docs/research/format-support.md`.
  - **Thumbnails and preview up to 2048 px:** Quick Look via Electron's `createThumbnailFromPath`. Call it only for the types that tested as working, because for others it returns a generic icon without an error.
  - **Full-resolution RAW:** the embedded JPEG.
  - **ProRes, mpg and dv playback:** conversion to H.264 with `avconvert` into app storage. Only ProRes has been tested.
  - **aiff:** converted to wav in the app.
