'use strict';

const fs = require('node:fs');

// Existence only: lstat does not follow symlinks, so a dangling link still
// counts as present.
async function defaultExists(filePath) {
  try {
    await fs.promises.lstat(filePath);
    return true;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return false;
    throw err;
  }
}

// Reveals exactly the given path in the OS file manager. There is no
// parent-directory fallback: a missing path is an error.
function createRevealer({ shell, exists = defaultExists }) {
  async function revealFile(filePath) {
    let present;
    try {
      present = await exists(filePath);
    } catch (err) {
      if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
        // The check itself was refused: say so, never claim the file is missing.
        const refused = new Error(`Can't check this file: permission denied (${err.code}): ${filePath}`);
        refused.code = 'FILE_UNCHECKABLE';
        throw refused;
      }
      throw err;
    }
    if (!present) {
      const err = new Error(`File not found: ${filePath}`);
      err.code = 'FILE_NOT_FOUND';
      throw err;
    }
    shell.showItemInFolder(filePath);
  }
  return { revealFile };
}

module.exports = { createRevealer, defaultExists };
