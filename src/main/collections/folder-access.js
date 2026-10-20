'use strict';

/*
 * Folder access (FR-1, FR-4, OQ-10). The one place that decides whether a
 * collection folder can be read, and how a folder is scanned. Main-process
 * logic with no Electron imports; used by service.js and rescan.js.
 *
 *   defaultScan(folderPath)         -> Promise<FileRecord[]> (the worker scan)
 *   checkReadableDirectory(dir)     -> Promise<null | { code, message }>
 *       null when dir is a directory that can be opened for listing; otherwise
 *       the error code and the user-facing message.
 *   isReadableDirectory(dir)        -> Promise<boolean>
 *   scanFolder(scan, dir)           -> Promise<{ records, unavailable }>
 *       a scan that rejects gives { records: [], unavailable: true } (FR-4).
 */

const fs = require('node:fs');

function defaultScan(folderPath) {
  return require('../discovery/run-scan.js').runScan(folderPath);
}

// Opens the directory for listing and closes it without reading any entry.
// This is the operation that failed with EPERM on a measured external drive
// (docs/measurements/atime-cat-read.md) and with EACCES on a mode-000 folder.
async function openForListing(dir) {
  const handle = await fs.promises.opendir(dir);
  await handle.close();
}

function unreadable(dir, err) {
  const code = err.code || err.message;
  return { code, message: `Folder does not exist or cannot be read: ${dir} (${code})` };
}

async function checkReadableDirectory(dir) {
  let stat;
  try {
    stat = await fs.promises.stat(dir);
  } catch (err) {
    return unreadable(dir, err);
  }
  if (!stat.isDirectory()) return { code: 'ENOTDIR', message: `Not a directory: ${dir}` };
  try {
    await openForListing(dir);
  } catch (err) {
    return unreadable(dir, err);
  }
  return null;
}

async function isReadableDirectory(dir) {
  return (await checkReadableDirectory(dir)) === null;
}

async function scanFolder(scan, dir) {
  try {
    return { records: await scan(dir), unavailable: false };
  } catch {
    return { records: [], unavailable: true };
  }
}

module.exports = { defaultScan, checkReadableDirectory, isReadableDirectory, scanFolder };
