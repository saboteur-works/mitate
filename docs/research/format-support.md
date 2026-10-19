# Research: Format Support

**Date:** 2026-10-18
**Question:** Which formats can the app preview and play, given the Electron leaning? (Former OQ-1; resolved in `specs/product/media-organizer-mvp.md`.) Which fallback paths cover the rest?
**Machine:** Apple M4 Pro, macOS 26.5.1. **Runtimes:** Electron 44.9.0 (Chromium 152.0.7977.167), sharp 0.35.5 (libvips 8.18.7).
**Probe:** `tools/format-probe/`. Raw results are saved next to the scripts.

## Method

- **Corpus:** `gen.sh` generated about 75 two-second samples with ffmpeg 8.1.1, sips and afconvert, covering most container and codec pairs. For RAW, I used five real camera files from raw.pixls.us: Canon R6 CR3, Fuji X-T4 RAF, Nikon Z 6 NEF, Sony A7 IV ARW (lossless compressed) and iPhone 12 Pro DNG.
- **Electron** (`electron/`): a hidden window loads each file from `file://`.
  - An image passes if it loads and draws non-blank pixels to a canvas.
  - Audio and video pass if they play for 1.2 s with decoded bytes greater than 0.
  - Video additionally needs decoded frames greater than 0 and a non-blank frame.
  - Audio and video decoding are recorded separately.
- **macOS native** (`native.swift`):
  - Images are fully decoded with ImageIO. I also timed embedded-thumbnail extraction and 512 px thumbnails.
  - For audio and video, AVFoundation reports `isPlayable` per track. **That is a metadata check, not a decoded frame.** Native audio and video results are therefore weaker evidence than the Electron ones.
- **Cross-platform image decoding:** the `sharp` prebuilt binaries, plus a 40-line pure-JS extractor of the embedded JPEG in RAW files (`rawprev.js`).

## Results

### Tier A: Electron plays these with no extra work (measured)

| Kind | Formats |
|---|---|
| Images | JPEG, PNG, GIF, APNG, WebP, AVIF, BMP, ICO, SVG |
| Video | H.264 (8- and 10-bit), HEVC (`hvc1` and `hev1`, 10-bit), AV1, VP8, VP9, in MP4 / MOV / M4V / 3GP / **MKV** / WebM |
| Audio | MP3, AAC (.m4a, .aac), FLAC (.flac, .mka), WAV (16-bit, 24-bit, float), Opus (.ogg, .opus, .webm), Vorbis |

Two traps the app must handle:
- **A video plays silently when its audio track is AC-3, E-AC-3 or ALAC.** The video decodes, but zero audio bytes are decoded and no error is raised.
- **ProRes 422 .mov passes `loadeddata` and plays its audio, but decodes zero video frames.** ProRes 4444 errors outright.

So success can't be judged from load events. The player has to check decoded frames and audio bytes, or know the codec from metadata.

### Tier B: not playable in Electron, but macOS decodes them (measured)

| Kind | Formats | Native evidence |
|---|---|---|
| Images | HEIC, TIFF, PSD, JPEG 2000, TGA, OpenEXR, ICNS, all 5 RAW samples | full ImageIO decode |
| Audio | AIFF, AIFF-C, CAF, ALAC, AC-3, E-AC-3, MP2 | `isPlayable` only |
| Video | ProRes 422/4444, MPEG-2 (.mpg), MPEG-TS (.ts, .m2ts), DV, MJPEG in AVI | `isPlayable` only |

Covering Tier B on macOS needs a native step. Image cost is measured:
- A 512 px ImageIO thumbnail takes 0–14 ms for ordinary images.
- For RAW, a 512 px thumbnail takes 306–2603 ms and a full decode 97–1770 ms.
- Reading the embedded preview instead takes 11–126 ms.

Audio and video would need either transcoding into the app cache or a native player view. Neither has been measured.

### Tier C: cross-platform, no OS decoder (measured)

**Embedded RAW previews.** A pure-JS scan found a baseline JPEG in all 5 RAW files in 3–31 ms (read plus scan). Each JPEG decoded in Electron.

| File | Preview size | Full RAW size |
|---|---|---|
| Canon CR3 | 3408×2272 | same as full decode |
| Nikon NEF | 6048×4024 | same as full decode |
| Sony ARW | 7008×4672 | same as full decode |
| iPhone DNG | 4032×3024 | same as full decode |
| Fuji RAF | 4416×2944 | 6240×4160 |

This is the cheapest RAW path found. It's five cameras with one file each, so older or less common bodies may embed smaller previews or none (unmeasured).

**`sharp` prebuilt** decodes TIFF and AVIF, and reads DNG and NEF as TIFF. NEF fails on a warning unless that check is relaxed, and its result is likely only the small preview IFD (not checked). It does **not** decode:
- **HEIC.** Its heif input is limited to `.avif`.
- PSD, JPEG 2000, OpenEXR, BMP, CR3, RAF or ARW.

It adds little over Tier A plus the RAW-preview extractor.

### Tier D: neither Electron nor macOS (measured)

WMV, WMA, AVI (MPEG-4 Part 2, or H.264 with MP3), FLV, DNxHD, DDS.

A bundled FFmpeg could decode these, since ffmpeg produced the samples. But it hasn't been tested in-app, and it raises the licensing questions below.

### Native step, no native code (measured 2026-10-18, follow-up)

**Electron `nativeImage.createThumbnailFromPath` (Quick Look on macOS)** (`quicklook/`)

| | Formats |
|---|---|
| Real content | HEIC, TIFF, PSD, JPEG 2000, TGA, EXR, ICNS, all 5 RAW, PDF, TXT, RTF, Markdown, HTML, SVG; video in MP4, MOV, M4V, 3GP, .ts, .mpg, DV and MJPEG AVI, including ProRes 422/4444, HEVC `hvc1` and AV1 in MP4 |
| Generic file icon | MKV, WebM, FLV, AVI (MPEG-4 Part 2, H.264), WMV, DNxHD, .m2ts, HEVC `hev1`, DDS, APNG, an unknown extension, and every audio sample |

- **It raises no error when it falls back to an icon.** The app should only call it for types on the content list, and use Chromium for the rest.
  - The audio samples had no cover art. Whether embedded art would show is unmeasured.
- **Size cap.** It returns at most 2048 px on the long edge, which is 2× the requested size on this Retina display.
  - A 1024–1536 px request gave a 2048×1363 NEF.
  - A 2048 px request returned the generic icon.
  - So it serves grid thumbnails and a quick full-window view, not full-resolution zoom.
- **Time** (512 px request):
  - 10–70 ms for most images and video.
  - 49–135 ms for RAW, and 140–210 ms for RAW at the cap.
  - Slower outliers: AVIF 207 ms, PDF 111 ms, Markdown 137 ms, HTML 684 ms, and 351 ms for the first call.
  - That's faster than the 300–2603 ms an ImageIO 512 px thumbnail took for RAW.
  - Why it's faster (for example, Quick Look reading the embedded preview) is untested.
- **Platforms.** Electron's docs list this API for macOS and Windows. I haven't verified that, or what Windows renders.

**ProRes transcode with `avconvert`**, the AVFoundation export CLI that ships with macOS. Sources were noisy synthetic test patterns, and every output played in Electron with picture and sound.

| Source | Output | Time | Speed |
|---|---|---|---|
| 1080p ProRes 422, 30 s, 576 MB | H.264 or HEVC 1080p (34–40 MB), or 720p | 5.5–6.0 s | ~5× realtime |
| 4K ProRes 422 HQ, 10 s, 1.14 GB | H.264 or HEVC 1080p, or 720p | 3.0 s | ~3.3× realtime |
| 4K, a 2 s or 5 s segment (`--start`/`--duration`) | 1080p | 2.03 s each | about 2 s startup |

- The sources had just been written, so they were probably read from memory.
  - 4K ProRes HQ is about 114 MB/s. From an external HDD or NAS, reading may be the bottleneck. That's unmeasured.
- A whole-file transcode must finish before it can play.
  - Extrapolating from the 1080p rate, a 10-minute 1080p clip would take about 2 minutes. That's not measured.
  - Converting in segments would start playback in about 2 s. Joining the segments into continuous playback is untested.

## What this changes

- **Most of the concept's Electron caveat is now measured.** HEIC, TIFF, RAW, PSD, ProRes, AIFF and ALAC all fail in Electron 44.9.0.
- **MKV and WebM are not "preview not available" under Electron.** MKV with H.264, HEVC or VP9 plays, and so does FLAC in MKA. macOS can't play them. The two runtimes complement each other: their union covers everything here except Tier D.
- **MPEG-TS (.ts, .m2ts) fails in Electron.** Consumer camcorders (AVCHD) and screen recorders produce it, so it matters for the video-editor audience.
- **Tier B audio and video are likely the hardest part of an Electron MVP.** A practical starting point may be a JS byte-swap from AIFF to WAV, plus remuxing TS to MP4, which needs no re-encode. Neither is measured.

## Not measured, and what would settle it

- **Windows and Linux.** Chromium's HEVC decoding uses the platform decoder, so Tier A HEVC may not hold off macOS. Settle by running `tools/format-probe/electron` on Windows and Linux machines.
- **Native audio/video decode.** `isPlayable` isn't proof of decoding. Settle with an AVPlayer frame-and-sample check in `native.swift`.
- **Real-world files.** The synthetic samples are not camera files: no iPhone HEVC/Dolby Vision, no Live Photos, no Canon/Sony MP4 with timecode tracks, no ProRes RAW. Settle by re-running the probe on a folder of real files.
- **JPEG XL.** No sample, and `canPlayType("image/jxl")` returned "" in Electron. macOS lists JXL as readable but not writable.
- **Licensing (from prior knowledge, not checked this session).**
  - Patent licensing for HEVC and for Electron's bundled H.264/AAC decoders.
  - FFmpeg is LGPL only when built without GPL components such as x264.
  - LibRaw is LGPL-2.1/CDDL.
  - That `sharp`'s missing HEIC support is a patent choice is my hypothesis from its configuration, not confirmed.
  - Check these before choosing to bundle anything.

## Reproduce

```sh
bash tools/format-probe/gen.sh                 # run inside an empty corpus dir
<Electron.app>/Contents/MacOS/Electron tools/format-probe/electron \
  --user-data-dir=/tmp/ud --corpus=<corpus> --out=results.json
swiftc -O tools/format-probe/native.swift -o native && ./native <corpus>
node tools/format-probe/rawprev.js <outdir> <corpus>/r_*
```

The Electron and Swift probes must run outside the Claude Code sandbox, because it blocks Mach ports and the HEIC and AVIF encoders.
