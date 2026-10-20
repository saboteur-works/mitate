'use strict';

// Main-process confirmation dialog seam. Resolves true only when the user
// picks the confirm button; Cancel resolves false; a failed dialog rejects.
function createConfirmer({ dialog, getWindow }) {
  return async function confirm({ title, message, detail, confirmLabel }) {
    const options = {
      type: 'warning',
      title,
      message,
      detail,
      buttons: [confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    };
    const win = getWindow();
    const usable = win && !(typeof win.isDestroyed === 'function' && win.isDestroyed());
    const result = usable
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    return result.response === 0;
  };
}

module.exports = { createConfirmer };
