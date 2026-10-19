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
 * Set MO_E2E_VISIBLE=1 to run with normal, visible windows (for debugging).
 */

const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');

if (process.env.MO_E2E_VISIBLE !== '1') {
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
    get: (target, key) => (key === 'BrowserWindow' ? HiddenWindow : target[key]),
  });
  const load = Module._load;
  Module._load = function loadWithBackgroundElectron(request, ...rest) {
    return request === 'electron' ? backgroundElectron : load.call(this, request, ...rest);
  };
  if (process.platform === 'darwin') electron.app.setActivationPolicy('accessory');
}

require(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'));
