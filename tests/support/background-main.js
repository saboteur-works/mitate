'use strict';

/*
 * Test-only Electron entry point. It loads the real app (src/main/main.js)
 * unchanged, but runs it in the background so e2e tests don't take over the
 * screen:
 *   - macOS: the app runs with the "accessory" activation policy (no Dock
 *     icon).
 *   - The app's code gets a copy of the `electron` module whose BrowserWindow
 *     always creates windows with `show: false` and background throttling
 *     off, so the window is never shown (showing it is what activates the
 *     app) and the hidden page keeps rendering and running timers.
 *
 * Hiding the window after creation is not enough: measured 2026-10-19, a
 * window hidden in 'browser-window-created' was shown again by Electron's
 * default show, and the app became the frontmost app. Electron's exports
 * can't be redefined ("Cannot redefine property: BrowserWindow"), hence the
 * module-load hook below.
 *
 * The same copy of `electron` records ipcMain.handle registrations in
 * globalThis.__moIpcHandlers (channel -> handler) for tests/support/ipc-wrap.js.
 *
 * The same copy also replaces `shell` with a proxy whose showItemInFolder is a
 * stub: it pushes its argument onto globalThis.__moReveals (an array, empty at
 * load) and does nothing else, so a test never opens a Finder window. The real
 * shell.showItemInFolder is never called, under any condition, including
 * MO_E2E_VISIBLE=1: the stub applies regardless of visibility. Every other key
 * of `shell` goes to the real shell. The channel code in src/main (argument
 * guard, index check, existence check) is not stubbed and still runs.
 *
 * Set MO_E2E_VISIBLE=1 to run with normal, visible windows (for debugging).
 * Windows become visible; the shell stub stays in place.
 */

const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');

// Every handler the app registers with ipcMain.handle is recorded here, keyed by
// channel, so a test can wrap it (tests/support/ipc-wrap.js). Test-only: the
// app's own code does not know about it.
globalThis.__moIpcHandlers = new Map();
const recordingIpcMain = new Proxy(electron.ipcMain, {
  get(target, key) {
    if (key === 'handle') {
      return (channel, fn) => {
        globalThis.__moIpcHandlers.set(channel, fn);
        return target.handle(channel, fn);
      };
    }
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

// showItemInFolder is recorded, never forwarded. Other shell members are the real ones.
globalThis.__moReveals = [];
const recordingShell = new Proxy(electron.shell, {
  get(target, key) {
    if (key === 'showItemInFolder') {
      return (fullPath) => {
        globalThis.__moReveals.push(fullPath);
      };
    }
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

const visible = process.env.MO_E2E_VISIBLE === '1';
class HiddenWindow extends electron.BrowserWindow {
  constructor(options = {}) {
    super({
      ...options,
      show: false,
      webPreferences: { ...(options.webPreferences || {}), backgroundThrottling: false },
    });
  }
}
const backgroundElectron = new Proxy(electron, {
  get(target, key) {
    if (key === 'ipcMain') return recordingIpcMain;
    if (key === 'shell') return recordingShell;
    if (key === 'BrowserWindow' && !visible) return HiddenWindow;
    return target[key];
  },
});
const load = Module._load;
Module._load = function loadWithBackgroundElectron(request, ...rest) {
  return request === 'electron' ? backgroundElectron : load.call(this, request, ...rest);
};
if (!visible && process.platform === 'darwin') electron.app.setActivationPolicy('accessory');

require(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'));
