# Product Spec: Media Organizer — v1

**Milestone scope:** v1
**Status:** Draft
**Source concept:** Media Organizer (working title), `docs/concept.md`
**Builds on:** `media-organizer-mvp.md`. This spec cites MVP requirements and stories as "MVP FR-n" and "MVP US-n".

## Overview
v1 makes the MVP useful day to day for large archives. It adds:
- filename search and attribute filters;
- tags, favorites and ratings that live only in the app's data;
- an index that follows changes on disk and handles drives that come and go;
- previews for a wider set of document and media types;
- metadata display.

The read-only guarantee from MVP still holds: no organization a user adds is ever written to their files.

## Goals
- A user can find a file by name or attribute without browsing.
- A user can tag, favorite and rate files, and every file stays byte-for-byte and attribute-for-attribute unchanged.
- The index matches the disk, including after files change and drives reconnect, without a manual rescan.
- A user can see a file's EXIF, audio tags, duration and resolution, and filter by them.

## Non-goals
- **Everything excluded by the MVP spec:** file management, editing, importing, individual files, sync, and Windows/Linux.
- **Writing tags or ratings to files or Finder tags** (see OQ-3).
- **Everything in the v2 spec:** content search, smart collections, the offline-drive catalog, the duplicate report and mobile.

## Users

**Creative professional**
A photographer, musician, video editor or designer with an archive of hundreds of thousands of files, often on external drives or a NAS.
**Key need:** Narrow a large archive quickly and tell similar files apart.
**Success looks like:** They find a specific take or shot by attributes, and the index is right after swapping drives.

**Hobbyist / personal user**
Someone with thousands to tens of thousands of files across a few folders and drives.
**Key need:** Find a file they remember and organize media their own way.
**Success looks like:** They find a file by name and keep favorites without touching the files.

## User Stories

*Creative professional*
- US-1: As a creative professional, I want to filter by type, date, size, duration and dimensions so that I can narrow a large archive quickly. [v1]
- US-2: As a creative professional, I want to see EXIF and audio-tag metadata so that I can tell similar files apart. [v1]
- US-3: As a creative professional, I want the index to follow changes on disk and handle drives that come and go so that the app stays accurate without manual rescans. [v1]

*Hobbyist / personal user*
- US-4: As a hobbyist, I want to search by filename so that I can find a file I remember the name of. [v1]
- US-5: As a hobbyist, I want to tag, favorite and rate files without changing them so that I can organize my media my way. [v1]

## Functional Requirements

### v1 Requirements
- FR-1: Users MUST be able to search the active collection by filename substring. [US-4]
- FR-2: Users MUST be able to filter by media type, modified date, size, duration and dimensions, and to combine filters with search. [US-1]
- FR-3: Users MUST be able to add and remove tags, mark favorites, and set a rating on any file. [US-5] [BLOCKED: OQ-4]
- FR-4: Tags, favorites and ratings MUST be stored only in app data. Files, including their extended attributes and Finder tags, MUST be unchanged. [US-5, MVP US-3] [BLOCKED: OQ-3]
- FR-5: Tags, favorites and ratings SHOULD survive a file being renamed or moved within the collection. [US-5] [BLOCKED: OQ-2]
- FR-6: Files added, removed or renamed on disk MUST be reflected in the index without a manual rescan, both while the app is running and after relaunch. [US-3]
- FR-7: Files on a disconnected drive MUST be hidden from all views. They MUST reappear without user action when the drive reconnects. [US-3]
- FR-8: Users MUST be able to preview Markdown, HTML, SVG, fonts, USDZ, Office/iWork documents and SRT subtitles. Live Photos MUST appear as one item showing both the still and the motion clip. [MVP US-4] [BLOCKED: OQ-6]
- FR-9: Users MUST be able to turn on settings that include hidden files, package contents and symlinked folders. With symlinks on, link loops MUST NOT cause an endless scan, and MVP FR-6 MUST still hold. [MVP US-5]
- FR-10: The app MUST display the EXIF fields, audio tags, duration and resolution present in a file, and users MUST be able to filter by them. [US-2]

## Constraints
- **MVP constraints still hold:** macOS first, Electron desktop runtime, read-only including extended attributes, app-storage-only data, large archives as the normal case, and offline operation.
- **Tag storage.** Tags, favorites and ratings are user data that can't be rebuilt from disk. Unlike the index and thumbnails, they must not be lost when the cache is cleared or rebuilt.
- **Keeping the index current** must work on external drives and network volumes, where change notification may be less reliable than on internal disks.

## Open Questions

**OQ-1: What numeric targets apply to how quickly disk changes appear in the index?**
This shares a measurement plan with MVP OQ-1.
**Impact:** FR-6.
**Owner:** Product owner with engineering lead

**OQ-2: How is a file recognized across renames, moves and drive remounts?**
**Impact:** FR-5, FR-7.
**Owner:** Engineering lead

**OQ-3: Can app tags ever be exported or mirrored to Finder tags?**
Mirroring would write extended attributes and conflict with MVP FR-17.
**Impact:** FR-4.
**Owner:** Product owner

**OQ-4: What scale do ratings use, and can users filter by tags, favorites and ratings?**
**Impact:** FR-2, FR-3.
**Owner:** Product designer

**OQ-5: What happens when a collection's folder is deleted or renamed on disk, as opposed to its drive being disconnected?**
**Impact:** FR-6, FR-7.
**Owner:** Product designer

**OQ-6: Can the FR-8 formats be previewed with the MVP approach (Electron plus macOS tools)?**
Quick Look rendered content thumbnails for Markdown, HTML, SVG, txt and rtf. The other FR-8 formats are untested: fonts, USDZ, Office/iWork, SRT and Live Photos.
**Impact:** FR-8.
**Owner:** Engineering lead

## Out of Scope (Deferred)
- [v2] Content search, and possibly OCR.
- [v2] Saved searches and smart collections.
- [v2] Browsing files on disconnected drives (an offline catalog).
- [v2] A duplicate-file report.
- [v2] A paid mobile app.
- [post-v2] Windows and Linux desktop releases.
- [post-v2] Third-party decoders (MVP OQ-4).
- [post-v2] Adding individual files to a collection.

## Resolved decisions (2026-10-18)
- **Files on disconnected drives** are hidden until the drive returns (FR-7).
- **Hidden files, package contents and symlinks** are opt-in settings in v1 (FR-9).
