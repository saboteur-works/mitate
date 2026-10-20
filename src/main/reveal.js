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
    if (!(await exists(filePath))) {
      const err = new Error(`File not found: ${filePath}`);
      err.code = 'FILE_NOT_FOUND';
      throw err;
    }
    shell.showItemInFolder(filePath);
  }
  return { revealFile };
}

module.exports = { createRevealer, defaultExists };
