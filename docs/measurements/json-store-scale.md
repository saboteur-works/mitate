# JSON store scale measurement (FR-18)

Produced by `node tools/store-scale/measure.js` (sizes 50000,200000,500000; 5 runs per size per operation).
This file records only what was measured.

## Environment

- date: 2026-10-19T17:16:45.039Z
- machine model: Mac16,8 (sysctl -n hw.model)
- CPU: Apple M4 Pro (sysctl -n machdep.cpu.brand_string)
- logical CPUs (os.cpus().length): 12
- RAM: 25769803776 (sysctl -n hw.memsize) bytes
- OS (sw_vers): ProductName:		macOS | ProductVersion:		26.5.1 | BuildVersion:		25F80
- Node version (process.version): v24.15.0
- Electron version: 44.9.0 (node_modules/electron/package.json)
- The script runs under plain Node, not inside Electron.
- temporary storage location: a directory created with fs.mkdtempSync under os.tmpdir() (/var/folders/qk/x8z53mfn36q33gbbzrhmpws00000gn/T), outside any collection folder, removed after each size
- total script elapsed time: 6.2 s

## Method

- Module measured: src/main/storage/index.js (openStorage, transaction, setFolderUnavailable), called in-process.
- FileRecord shape: folderId, collectionId (set by replaceFolderIndex), path (absolute), relativePath, name, extension, kind; subtype ("raw") on every fifth image record; unavailable (false) on every 1000th record.
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
| 50000 | 11206689 | 62.67 | 276643840 |
| 200000 | 44824689 | 212.56 | 804470784 |
| 500000 | 112060689 | 567.98 | 1510850560 |

### Load

`openStorage` on an existing populated store.

| size | runs (ms, in order) | min ms | median ms | max ms |
|---|---|---|---|---|
| 50000 | 16.80, 18.20, 18.91, 16.21, 16.28 | 16.21 | 16.80 | 18.91 |
| 200000 | 76.45, 66.64, 79.41, 63.23, 65.39 | 63.23 | 66.64 | 79.41 |
| 500000 | 173.50, 196.52, 164.85, 171.71, 171.91 | 164.85 | 171.91 | 196.52 |

### Save

One `setFolderUnavailable("f0", false)` call (one full-state write).

| size | runs (ms, in order) | min ms | median ms | max ms |
|---|---|---|---|---|
| 50000 | 13.76, 13.08, 14.07, 13.09, 12.07 | 12.07 | 13.09 | 14.07 |
| 200000 | 58.80, 68.49, 55.17, 53.10, 56.63 | 53.10 | 56.63 | 68.49 |
| 500000 | 130.96, 106.32, 103.89, 109.83, 148.07 | 103.89 | 109.83 | 148.07 |

### Transaction commit

One `transaction` call with 4 mutations (one full-state write).

| size | runs (ms, in order) | min ms | median ms | max ms |
|---|---|---|---|---|
| 50000 | 36.36, 36.88, 37.18, 36.30, 34.39 | 34.39 | 36.36 | 37.18 |
| 200000 | 155.09, 156.25, 148.00, 160.32, 155.47 | 148.00 | 155.47 | 160.32 |
| 500000 | 407.52, 365.39, 358.38, 373.92, 368.61 | 358.38 | 368.61 | 407.52 |
