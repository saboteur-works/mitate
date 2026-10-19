# JSON store scale measurement (FR-18)

Produced by `node tools/store-scale/measure.js` (sizes 50000,200000,500000; 5 runs per size per operation).
This file records only what was measured.

## Environment

- date: 2026-10-19T18:47:31.982Z
- machine model: Mac16,8 (sysctl -n hw.model)
- CPU: Apple M4 Pro (sysctl -n machdep.cpu.brand_string)
- logical CPUs (os.cpus().length): 12
- RAM: 25769803776 (sysctl -n hw.memsize) bytes
- OS (sw_vers): ProductName:		macOS | ProductVersion:		26.5.1 | BuildVersion:		25F80
- Node version (process.version): v24.15.0
- Electron version: 44.9.0 (node_modules/electron/package.json)
- The script runs under plain Node, not inside Electron.
- temporary storage location: a directory created with fs.mkdtempSync under os.tmpdir() (/var/folders/qk/x8z53mfn36q33gbbzrhmpws00000gn/T), outside any collection folder, removed after each size
- total script elapsed time: 8.3 s

## Method

- Module measured: src/main/storage/index.js (openStorage, transaction, setFolderUnavailable), called in-process.
- FileRecord shape: folderId, collectionId (set by replaceFolderIndex), path (absolute), relativePath, name, extension, kind; subtype ("RAW" on the cr2 records). Extension, kind and subtype are taken from the supported-type registry, as discovery produces them.
- Generated paths: `/Volumes/Media/Collection/Folder<n>/<year 2015-2024>/<month 01-12>/event-<0-199>/IMG_<7-digit index>.<ext>`; extensions jpg, png, cr2, mp4, mov, wav, pdf, txt. The files do not exist on disk.
- Population: one collection, 5 folders, records split evenly across the folders (remainder in the last), written in a single storage.transaction.
- store.json size: fs.statSync size in bytes after population.
- LOAD: time of `openStorage({ location: { file } })` on the existing populated store.json (reads and JSON.parses the file). Runs are repeated in the same process, so every run after the first executes with JIT-warm code; the individual values are listed in order.
- SAVE: time of one `storage.setFolderUnavailable("f0", false)` call, a non-transactional mutator that persists the full state in one write-then-rename (the whole state is JSON.stringify-ed and written).
- TRANSACTION: time of one `storage.transaction(fn)` call including its commit write, where fn performs 4 mutations: putCollection (rename the collection), setFolderUnavailable("f0", true), setFolderUnavailable("f1", false), setFolderAccess("f2", { bookmark }). The call includes the deep snapshot the module takes before fn.
- Timing: process.hrtime.bigint around each call.
- OS file cache: runs are repeated in the same process right after the store file was written, so the file was recently written. No cold-cache run was made; no cold-cache numbers are claimed.
- Memory: `process.memoryUsage().rss` read once after all runs of a size, before that size's temporary directory was removed. It is the RSS of the whole process at that point, not a peak.

## Results

| size (file records) | store.json bytes | populate ms (single run) | process.memoryUsage().rss after the size (bytes) |
|---|---|---|---|
| 50000 | 11283189 | 59.08 | 287064064 |
| 200000 | 45130689 | 219.09 | 632799232 |
| 500000 | 112825689 | 552.46 | 1044119552 |

### Load

`openStorage` on an existing populated store.

| size | runs (ms, in order) | min ms | median ms | max ms |
|---|---|---|---|---|
| 50000 | 23.89, 22.51, 18.91, 22.85, 17.58 | 17.58 | 22.51 | 23.89 |
| 200000 | 89.94, 81.10, 77.91, 87.46, 84.67 | 77.91 | 84.67 | 89.94 |
| 500000 | 236.03, 296.40, 224.41, 221.95, 223.40 | 221.95 | 224.41 | 296.40 |

### Save

One `setFolderUnavailable("f0", false)` call (one full-state write).

| size | runs (ms, in order) | min ms | median ms | max ms |
|---|---|---|---|---|
| 50000 | 16.07, 13.40, 14.34, 13.85, 12.01 | 12.01 | 13.85 | 16.07 |
| 200000 | 53.54, 64.80, 64.35, 54.05, 101.84 | 53.54 | 64.35 | 101.84 |
| 500000 | 124.39, 119.42, 135.22, 175.94, 185.75 | 119.42 | 135.22 | 185.75 |

### Transaction commit

One `transaction` call with 4 mutations (one full-state write).

| size | runs (ms, in order) | min ms | median ms | max ms |
|---|---|---|---|---|
| 50000 | 41.98, 38.12, 44.65, 40.33, 36.81 | 36.81 | 40.33 | 44.65 |
| 200000 | 202.38, 211.44, 235.04, 209.39, 207.53 | 202.38 | 209.39 | 235.04 |
| 500000 | 532.46, 818.62, 575.91, 447.53, 548.99 | 447.53 | 548.99 | 818.62 |
