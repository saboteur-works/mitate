# Scan wall time and peak RSS (FR-12)

Written by `node tools/scan-speed/measure.js` at 2026-10-19T17:17:05.018Z. This file records only what was measured.

## Machine

- model (sysctl hw.model): Mac16,8
- CPU (sysctl machdep.cpu.brand_string): Apple M4 Pro
- RAM (sysctl hw.memsize): 25769803776 bytes (24 GiB)
- OS (sw_vers): ProductName:		macOS; ProductVersion:		26.5.1; BuildVersion:		25F80
- Node version: v24.15.0
- Electron version: 44.9.0 (node_modules/electron/package.json)
- the script runs under plain Node, not inside Electron

## Method

- discovery runs in the worker thread through `runScanWithInfo` in `src/main/discovery/run-scan.js`; the record count is the length of the returned records
- wall time: `process.hrtime.bigint()` in the measuring child process from before the `runScanWithInfo` call until its promise resolved; it excludes child process start-up
- each run is a separate child process (`node tools/scan-speed/measure.js --child <folder>`), run one after another, in the order listed in the tables
- /usr/bin/time -l check: worked
- peak RSS: "maximum resident set size" reported by `/usr/bin/time -l` for the child process (whole process, includes Node start-up and the worker thread), converted from bytes to MiB
- start RSS: `process.memoryUsage.rss()` in the child before the scan call; "sampled peak RSS" is the largest `process.memoryUsage.rss()` value sampled every 10 ms plus one read after the scan
- runs per tree: 5 requested
- cache state: not controlled; no cache purge was performed. The generated tree was written shortly before its runs. Run 1 of the /System/Library tree is the first scan of it by this script; whether those directories were already cached is not known

## (a) Generated tree

- location: under os.tmpdir() (`/var/folders/qk/x8z53mfn36q33gbbzrhmpws00000gn/T`), a fresh `scan-speed-*` directory, removed after the runs
- filesystem: df -P: Filesystem   512-blocks      Used Available Capacity  Mounted on | /dev/disk3s5  965595304 813616424  58964784    94%    /System/Volumes/Data
- filesystem: mount: /dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)
- generator: `tools/scan-speed/generate-tree.js`, deterministic
- shape: depth 3 below the root, 20 x 10 x 10 directories per level (2000 leaf directories), 100 files per leaf directory (the last leaf directories may hold fewer), all files 0 bytes
- extension mix, percent of files by index modulo 100: jpg 70, png 10, cr2 5, mp4 5, mp3 4, pdf 2, xyz 2 (unsupported), tmp 1 (unsupported), log 1 (unsupported)
- files generated: 200000 (192000 with a supported extension, 8000 with an unsupported extension)
- generation time: 7504.0 ms
- removal after the runs: directory removed (6158 ms)

- scanned path: /var/folders/qk/x8z53mfn36q33gbbzrhmpws00000gn/T/scan-speed-zj3blO
- files generated: 200000
- runs requested: 5; runs completed: 5
- files found by discovery: 192000 (per run, distinct values)
- skipped directories (onError calls): 0, 0, 0, 0, 0 (per run in order)
- skipped directories by error code, run 1: none

| run | files found | wall time ms | start RSS MiB | peak RSS MiB (/usr/bin/time -l) | sampled peak RSS MiB | skipped dirs |
|---|---|---|---|---|---|---|
| 1 | 192000 | 400.4 | 46.2 | 431.9 | 431.8 | 0 |
| 2 | 192000 | 375.5 | 45.9 | 442.0 | 442.0 | 0 |
| 3 | 192000 | 390.1 | 45.8 | 450.8 | 450.8 | 0 |
| 4 | 192000 | 382.0 | 46.0 | 441.8 | 441.7 | 0 |
| 5 | 192000 | 376.1 | 45.8 | 441.5 | 441.4 | 0 |

- wall time ms: min 375.5, median 382.0, max 400.4
- peak RSS MiB (/usr/bin/time -l): min 431.9, median 441.8, max 450.8
- sampled peak RSS MiB: min 431.8, median 441.7, max 450.8

## (b) Real read-only tree

- scanned path: /System/Library (read-only; this script only scans it and writes nothing inside it)
- runs requested: 5; runs completed: 5
- files found by discovery: 4676 (per run, distinct values)
- skipped directories (onError calls): 67, 67, 67, 67, 67 (per run in order)
- skipped directories by error code, run 1: {"EPERM":4,"EACCES":63}

| run | files found | wall time ms | start RSS MiB | peak RSS MiB (/usr/bin/time -l) | sampled peak RSS MiB | skipped dirs |
|---|---|---|---|---|---|---|
| 1 | 4676 | 1292.4 | 46.0 | 93.8 | 91.2 | 67 |
| 2 | 4676 | 705.5 | 46.3 | 93.2 | 90.8 | 67 |
| 3 | 4676 | 643.5 | 45.8 | 92.5 | 90.6 | 67 |
| 4 | 4676 | 701.6 | 46.0 | 93.6 | 91.8 | 67 |
| 5 | 4676 | 628.6 | 45.6 | 92.4 | 90.8 | 67 |

- wall time ms: min 628.6, median 701.6, max 1292.4
- peak RSS MiB (/usr/bin/time -l): min 92.4, median 93.2, max 93.8
- sampled peak RSS MiB: min 90.6, median 90.8, max 91.8

## Elapsed

- total script time: 19.9 s
