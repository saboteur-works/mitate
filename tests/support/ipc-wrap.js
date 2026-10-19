'use strict';

const path = require('node:path');

const IPC_MODULE_PATH = path.join(__dirname, '..', '..', 'src', 'main', 'ipc.js');

// Runs inside the Electron main process via electronApp.evaluate, so it is
// serialised with Function.prototype.toString and must be self-contained.
// `require` is not in scope there, so a require is obtained from supported Node
// APIs: process.getBuiltinModule('module').createRequire(ipcPath) (Node >= 22.3),
// else process.mainModule.require. Requiring ipc.js by absolute path through it
// returns the SAME module instance main.js loaded (same resolved filename, so the
// same module-cache entry), hence the registry getRegisteredHandler reads is the
// one registerIpc filled.
function installWrapperInMain({ ipcMain }, { ipcPath, channel: ch, source }) {
  let req;
  if (typeof process.getBuiltinModule === 'function') {
    req = process.getBuiltinModule('module').createRequire(ipcPath);
  } else if (process.mainModule && process.mainModule.require) {
    req = process.mainModule.require.bind(process.mainModule);
  } else {
    throw new Error(
      'cannot obtain a require in the main process: ' +
        `typeof process.getBuiltinModule=${typeof process.getBuiltinModule}, ` +
        `typeof process.mainModule=${typeof process.mainModule}, ` +
        `process.versions.node=${process.versions && process.versions.node}, ` +
        `process.versions.electron=${process.versions && process.versions.electron}`,
    );
  }
  const { getRegisteredHandler } = req(ipcPath);
  const original = getRegisteredHandler(ch);
  if (typeof original !== 'function') {
    throw new Error(`ipc.js has no registered handler for ${ch}`);
  }
  const build = (0, eval)(`(${source})`);
  ipcMain.removeHandler(ch);
  ipcMain.handle(ch, build(original));
}

// Wraps the main-process handler of one IPC channel from an e2e test, using only
// supported APIs: the original handler is looked up with getRegisteredHandler()
// from src/main/ipc.js, then the channel is re-registered with
// ipcMain.removeHandler(channel) + ipcMain.handle(channel, wrapper).
//
// makeWrapper is a function (original) => handler. It is serialised with
// Function.prototype.toString and rebuilt in the main process, so it must be
// self-contained (no closure variables); it may use globalThis to share state with
// later app.evaluate calls. It must be an arrow function or function expression.
async function wrapHandler(electronApp, channel, makeWrapper) {
  await electronApp.evaluate(installWrapperInMain, {
    ipcPath: IPC_MODULE_PATH,
    channel,
    source: makeWrapper.toString(),
  });
}

module.exports = { wrapHandler, installWrapperInMain, IPC_MODULE_PATH };
