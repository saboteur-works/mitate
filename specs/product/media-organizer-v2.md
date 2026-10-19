# Product Spec: Media Organizer — v2

**Milestone scope:** v2
**Status:** Draft
**Source concept:** Media Organizer (working title), `docs/concept.md`
**Builds on:** `media-organizer-mvp.md`, `media-organizer-v1.md`. This spec cites requirements from those specs as "MVP FR-n" and "v1 FR-n".

## Overview
v2 serves power users, and brings the product to phones. It adds:
- search inside documents;
- saved searches that behave like collections;
- a catalog of drives that aren't connected;
- a read-only duplicate report;
- a paid mobile app.

Desktop entry stays free. The mobile app is the planned revenue source. Desktop monetization is still open.

## Goals
- A user can find a document by text it contains.
- A user can reopen a recurring search as a collection in one step.
- A user can see which disconnected drive holds a file.
- A user can see byte-identical copies within a collection without the app offering to change anything.
- A user can browse and preview their collections on a phone.

## Non-goals
- **Everything excluded by the MVP and v1 specs.**
- **Deleting or merging duplicates.** The report is read-only.
- **Windows and Linux desktop releases** (post-v2).

## Users

**Creative professional**
A photographer, musician, video editor or designer with an archive of hundreds of thousands of files, often across many archive drives.
**Key need:** Find files by content and locate files on drives that aren't plugged in.
**Success looks like:** They know which drive to connect before going looking.

**Hobbyist / personal user**
Someone with thousands to tens of thousands of files across a few folders and drives.
**Key need:** Reach their collections away from the desktop.
**Success looks like:** They browse and play their media from their phone.

## User Stories

*Creative professional*
- US-1: As a creative professional, I want to search text inside documents so that I can find files by what they contain. [v2]
- US-2: As a creative professional, I want saved searches that act like collections so that recurring queries are one click away. [v2]
- US-3: As a creative professional, I want to browse files on drives that aren't connected so that I know which drive holds a file before I plug it in. [v2]
- US-4: As a creative professional, I want a report of duplicate files so that I can find redundant copies myself. [v2]

*Hobbyist / personal user*
- US-5: As a hobbyist, I want a paid mobile app so that I can browse my collections on my phone. [v2]

## Functional Requirements

### v2 Requirements
- FR-1: Users MUST be able to search the text content of PDF and plain-text documents. They MAY also be able to search text recognized in images (OCR). [US-1]
- FR-2: Users MUST be able to save a search and filter combination as a smart collection that updates as the index changes. [US-2]
- FR-3: Users MUST be able to choose to show files from disconnected drives. These files MUST be labelled offline, with preview and reveal disabled. [US-3]
- FR-4: Users MUST be able to view a report of byte-identical files within a collection. The report MUST NOT offer to delete or change anything. It MAY also include visually similar images. [US-4]
- FR-5: A paid mobile app MUST let users browse and preview collections. [US-5] [BLOCKED: OQ-3, OQ-4, OQ-6]
- FR-6: Any v2 feature that requires payment on desktop MUST be identified. [BLOCKED: OQ-1, OQ-2]

## Constraints
- **MVP and v1 constraints still hold**, including read-only and app-storage-only data.
- **Mobile folder access.** iOS and Android grant folder access only through their system pickers, with persisted permissions. Most users' media there lives in the system photo library.
- **Mobile runtime.** It is leaning toward Capacitor, which is not decided. Preview there depends on WebKit (iOS) and Chromium (Android), and the macOS tools behind the desktop format approach aren't available.
- **Cost at scale.** Content indexing and similarity detection at professional archive scale are expensive. Their cost must not degrade MVP and v1 scanning.

## Open Questions

**OQ-1: How does desktop make money, if at all?**
The options are a one-time Pro unlock, or free for personal use and paid for commercial use. Meanwhile, an optional "support the project" payment measures who pays. Whether the source is open-core or fully public follows from this choice.
**Impact:** FR-6.
**Owner:** Product owner

**OQ-2: If encryption is offered, what is free and what is paid?**
Basic privacy protection is in scope for MVP OQ-5. Locked collections are a candidate paid feature.
**Impact:** FR-6.
**Owner:** Product owner

**OQ-3: What is a collection on mobile, where most media lives in the photo library? Can the photo library be a source?**
**Impact:** FR-5.
**Owner:** Product owner

**OQ-4: What makes the mobile app worth paying for beyond running on a phone?**
**Impact:** FR-5.
**Owner:** Product owner

**OQ-5: When do Windows and Linux follow, and what replaces "Reveal in Finder" on mobile?**
**Impact:** FR-5, MVP FR-16, the platform constraint.
**Owner:** Product owner

**OQ-6: Which formats can the mobile runtime preview?**
WebKit on iOS and Chromium on Android are unmeasured, and the desktop's macOS tools don't exist there. The embedded-JPEG route for RAW previews needs no OS decoder.
**Impact:** FR-5.
**Owner:** Engineering lead

## Out of Scope (Deferred)
- [post-v2] Windows and Linux desktop releases.
- [post-v2] Third-party decoders (MVP OQ-4).
- [post-v2] Adding individual files to a collection.

## Resolved decisions (2026-10-18)
- **Pricing:** desktop entry is free, and mobile is paid.
- **Timing:** mobile ships in v2, after the desktop core.
