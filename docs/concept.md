## Concept: Media Organizer (working title)

### Problem & Value
People keep their media in folders on internal disks, external drives and network shares. Over time it ends up spread across dozens of nested directories. Finder shows one folder at a time, so you can't see "every video in my project archive" or "all audio across these three drives" in one place. The tools that do aggregate media mostly want something in return. Apple Photos and Lightroom import files into a managed library. Eagle copies files into its own store. Others only handle one media type. People who want to leave their folder structure alone are left with Finder plus Spotlight, and neither was built for browsing media. Collections of external drives and NAS volumes keep growing, which makes this worse every year.

### Target Audience
- **Primary:** Creative professionals: photographers, musicians, video editors and designers with large archives (hundreds of thousands of files), often on external drives or a NAS. Their folder structure is deliberate and they won't let an app reorganize it.
- **Secondary:** Hobbyists and personal users with thousands to tens of thousands of files spread across a few folders and drives. They want one place to browse and play everything.

### Core Concept
The organizer is a read-only lens over folders the user already has. The user points it at folders and groups them into named **collections**, for example "Client Work 2025", "Sample Library" or "Family Archive". They can switch between collections like switching workspaces. Inside a collection, the app finds every supported media file, however deeply it's nested. The user can browse those files by the original folder tree or as flat views by type (all images, all audio, all video, all documents).

Read-only is the core idea, not a limitation. The app never moves, renames, edits or deletes a file, so users can safely point it at irreplaceable archives and work files that other tools depend on. Any organization the user adds, such as tags, favorites or ratings, lives only in the app's own data and never touches the files on disk.

Every file always keeps its connection to its real location. The full path is visible and the file is one action away from Finder. So the app works alongside Finder and the user's other tools instead of replacing them.

### Key Capabilities
- Users can create named collections of folders and switch between them.
- Users can see every supported media file in a collection, browsable by folder tree or by media type.
- Users can view and play images, audio, video and text/documents inside the app.
- Users can see any file's full location and reveal it in Finder.
- Users can search and filter by filename and by file attributes (type, date, size, duration, dimensions).
- Users can tag, favorite and rate files. That data is stored only in the app.
- Users can search embedded metadata and content: EXIF, audio tags, and text inside documents.

### Feature Milestones

**MVP**
- **Collections of folders, with switching:** this is the organizing unit everything else depends on. A folder can belong to several collections. If the user adds a subfolder of a folder already in the collection, the app tells them it's already covered and asks them to confirm.
- **Recursive discovery, with folder-tree and by-type views:** these deliver the core value of seeing all your media in one place. Hidden files are skipped.
- **In-app viewer and player for the formats macOS decodes natively, plus MKV and WebM, PDF and plain text:** without it the app is only a file list. Known formats outside that set (e.g. WMV, AVI, EPUB) are still indexed and locatable, and are shown as "preview not available."
- **Location display and reveal in Finder:** this keeps the app connected to the user's real file system from day one.

**v1**
- **Filename search and attribute filters:** large archives need these for daily use, but a small collection can be browsed without them.
- **Tags, favorites and ratings stored in the app:** this is the first layer of personal organization.
- **The index stays current as folders change, and files on disconnected drives are hidden until the drive returns:** daily users with external drives will hit this immediately.
- **Previews for Markdown, HTML, SVG, fonts, USDZ, Office/iWork documents, SRT subtitles and Live Photos, plus an option to include hidden files:** these round out coverage once the core formats work.
- **Metadata extraction for display and filtering (EXIF, audio tags, duration, resolution):** professional users need this to tell similar files apart.

**v2**
- **Content search (text inside documents, possibly OCR):** this is valuable, but indexing it at professional archive scale is expensive.
- **Saved searches and smart collections:** these are for power users who already rely on search every day.
- **Browsing drives that are offline (a catalog of disconnected volumes):** this matters most to people with many archive drives.
- **Visual similarity / duplicate surfacing (read-only, report only):** this suggests where the product could expand, but it isn't core.
- **Paid mobile app (iOS/Android):** this is the revenue source, and it's placed after desktop so it builds on a proven core.

### What This Is Not
- Not a file manager: it doesn't move, rename, copy, delete or create files.
- Not an editor: no cropping, trimming, transcoding or metadata writing.
- Not an importer: it never copies files into a managed library.
- Not for individual files: only folders can be added, for now.
- Not a sync or backup tool.
- Not on every platform at launch: desktop ships on macOS first. Windows/Linux and a paid mobile app come later.

### Competitive Landscape

**Eagle**
- A paid asset manager for designers (Mac/Windows), built on a managed library.
- Overlap: browsing many file types, tagging, filtering.
- Difference: Eagle imports files into its own library. This app indexes folders where they are.
- To learn from: its fast, filterable grid and browser-extension capture show how much users value quick visual scanning.

**Adobe Bridge**
- A free file browser for Creative Cloud users.
- Overlap: browsing folders in place, metadata display, previews.
- Difference: Bridge is folder-at-a-time and centered on Adobe. It has no multi-folder collections across drives and it writes metadata to files.
- To learn from: its metadata panel and filter sidebar are a mature reference.

**NeoFinder (formerly CDFinder)**
- A Mac disk cataloger used by archivists and photographers.
- Overlap: indexing many drives, browsing offline volumes, media metadata.
- Difference: it's built around cataloging, and its interface feels like a database tool more than a media browser.
- To learn from: offline-volume cataloging is a proven need for this audience. *(Current feature set not verified.)*

**Apple Photos / Lightroom Classic**
- Photo libraries used by most Mac users and photographers.
- Overlap: browsing, metadata, ratings and keywords.
- Difference: they cover images (and some video) only. Photos imports into a managed library, and Lightroom ties you to its catalog workflow.
- To learn from: Lightroom's "referenced files" model shows that professionals accept an index that sits over their own folders.

**Finder + Quick Look + Spotlight**
- The free default every Mac user already has.
- Overlap: preview, search, reveal.
- Difference: no aggregated media views, no collections, and it's poor at browsing many folders together.
- To learn from: Quick Look's instant preview sets the speed users expect.

**Differentiator:** This is the only tool that combines all of these: every media type, multi-folder collections spanning drives, and a strict guarantee that it never touches your files. For professionals, that guarantee and the switchable collections are what Bridge and Eagle structurally can't offer.

### Caveats & Pitfalls
- **Adoption:** For casual users, "good enough" is free (Finder plus Photos). Desktop has to win professionals on large-archive performance. Being merely pleasant to use won't be enough.
- **Monetization:** Until desktop monetization is decided, all revenue depends on the paid mobile app. It targets the least-validated use case, folder-based media on a phone, where most media lives in the system photo library instead. Free desktop users may not convert to mobile.
- **Execution:** Fast indexing and responsive grids at hundreds of thousands of files on slow external or network drives is the hardest part. Thumbnails and metadata extraction for video and RAW files are slow. If the first scan is slow, it defines the product.
- **Execution:** Electron 44.9.0 can't decode formats the primary audience depends on: HEIC, TIFF, RAW, PSD, ProRes, MPEG-TS, AIFF and ALAC (measured on macOS, 2026-10-18; see `docs/research/format-support.md`). Previewing them means decoding outside the web layer. That brings back per-OS code or bundled decoders, which cuts into the cross-platform savings.
- **Assumption:** This assumes users keep a clean folder structure they want to preserve. Hobbyists often don't. For them, views by type and date may matter more than the folder tree.
- **Assumption:** This assumes app-only tags are enough. Professionals may expect tags to show up in other tools, which pulls against the read-only promise.

### Technical Considerations
- **Runtime:** Electron for desktop (decided 2026-10-18). Capacitor for a paid mobile app is a leaning, not decided. Format requirements in the product spec should be the criteria for confirming this choice. Preview and playback therefore depend on each runtime's web engine: Chromium on desktop and Android, WebKit on iOS. Each has a different format set. Worth exploring: which formats get decoded outside the web layer (system tools, or bundled libraries such as libvips, libraw or FFmpeg), and at what licensing, size and per-OS cost. RAW files' embedded JPEG previews decoded in Electron for 5 of 5 cameras tested, so this is a cheap cross-platform route for RAW.
- **Folder access on mobile:** iOS and Android only grant folder access through their system pickers, with persisted permissions. On those platforms most users' media lives in the system photo library, not in folders. Worth validating before committing to mobile.
- **Distribution model vs. file access:** App Store sandboxing (Mac App Store, iOS) restricts persistent access to user-chosen folders and network volumes. That affects collections, external drives and pricing. Worth looking into early.
- **File identity:** How a file stays recognized across renames, moves and remounted drives decides whether tags and ratings survive. Worth exploring before v1.
- **Index scope:** Separating the cheap index (paths, sizes) from the expensive one (thumbnails, metadata, content) would let the MVP stay fast and v2 add depth.

### Open Questions
- Are third-party decoders (WMV, WMA, AVI, FLV, DNxHD) ever in scope, or do these formats stay index-only?
- What does "add a folder" mean on mobile, where most media lives in the system photo library? Is the photo library itself a valid collection source there?
- What separates the paid mobile app from the free desktop app beyond being on a phone? Is there a mobile-only feature, or is it the same app on a different device?
- Should app-level tags ever be exportable or mirrored to macOS Finder tags, given the read-only promise?
- Are package bundles (.app, .photoslibrary) and symlinks indexed or skipped?
- In what order do Windows and Linux follow the macOS desktop launch, and what replaces "reveal in Finder" on mobile?
- How does desktop make money, if at all? Entry must stay free. The candidates are a one-time Pro unlock for the v2 power features, or free for personal use and paid for commercial use (this needs a plain "who counts as commercial" rule). Supporting either is an optional "support the project" payment in the meantime, to measure who pays. The choice also decides whether paid features live in the public source or in a private module (open-core).
- If encryption is offered, what is free and what is paid? Encrypting the thumbnail cache and an app lock are basic privacy protection. Locked collections are a candidate paid feature.

**Resolved (2026-10-18):** Desktop entry is free and mobile is paid. Mobile is v2. Folders can belong to several collections, and adding a subfolder of an included folder needs confirmation. Files on disconnected drives are hidden. Hidden files are skipped in MVP and can be included by an option in v1. Format tiers follow the MVP/v1 items above. Electron is the desktop runtime. Formats it can't decode are handled with macOS's built-in tools (Quick Look thumbnails, embedded RAW previews, `avconvert` conversion into app storage), with no bundled decoders. See `specs/product/media-organizer-mvp.md` (Resolved decisions, OQ-2).

### Next Steps
The concept is ready to be specced with **write-product-spec**. The remaining open questions can be tracked in the spec. The framework question should be settled by measurement against the MVP format list before implementation starts.
