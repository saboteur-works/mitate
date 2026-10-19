'use strict';

const path = require('node:path');

const IPC_MODULE_PATH = path.join(__dirname, '..', '..', 'src', 'main', 'ipc.js');

// Wraps the main-process handler of one IPC channel from an e2e test, using only
// supported APIs: the original handler is looked up with getRegisteredHandler()
// from src/main/ipc.js (required by absolute path inside electronApp.evaluate, which
// runs in the Electron main process), then the channel is re-registered with
// ipcMain.removeHandler(channel) + ipcMain.handle(channel, wrapper).
//
// makeWrapper is a function (original) => handler. It is serialised with
// Function.prototype.toString and rebuilt in the main process, so it must be
// self-contained (no closure variables); it may use globalThis to share state with
// later app.evaluate calls. It must be an arrow function or function expression.
async function wrapHandler(electronApp, channel, makeWrapper) {
  await electronApp.evaluate(({ ipcMain }, { ipcPath, channel: ch, source }) => {
    const { getRegisteredHandler } = require(ipcPath);
    const original = getRegisteredHandler(ch);
    if (typeof original !== 'function') {
      throw new Error(`ipc.js has no registered handler for ${ch}`);
    }
    const build = (0, eval)(`(${source})`);
    ipcMain.removeHandler(ch);
    ipcMain.handle(ch, build(original));
  }, { ipcPath: IPC_MODULE_PATH, channel, source: makeWrapper.toString() });
}

module.exports = { wrapHandler, IPC_MODULE_PATH };
