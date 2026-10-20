'use strict';

// Runs inside the Electron main process via electronApp.evaluate, so it is
// serialised with Function.prototype.toString and must be self-contained.
// The original handler comes from globalThis.__moIpcHandlers, which
// tests/support/background-main.js fills as the app calls ipcMain.handle.
function installWrapperInMain({ ipcMain }, { channel, source }) {
  const original = globalThis.__moIpcHandlers && globalThis.__moIpcHandlers.get(channel);
  if (typeof original !== 'function') {
    throw new Error(`no recorded IPC handler for ${channel} (is the app started through background-main.js?)`);
  }
  const build = (0, eval)(`(${source})`);
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, build(original, channel));
}

// Wraps the main-process handler of one IPC channel from an e2e test: the
// recorded original is passed to makeWrapper, and the channel is re-registered
// with ipcMain.removeHandler(channel) + ipcMain.handle(channel, wrapper).
//
// makeWrapper is a function (original, channel) => handler. It is serialised with
// Function.prototype.toString and rebuilt in the main process, so it must be
// self-contained (no closure variables); it may use globalThis to share state with
// later app.evaluate calls. It must be an arrow function or function expression.
async function wrapHandler(electronApp, channel, makeWrapper) {
  await electronApp.evaluate(installWrapperInMain, { channel, source: makeWrapper.toString() });
}

module.exports = { wrapHandler };
