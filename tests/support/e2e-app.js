'use strict';

/*
 * Helpers shared by the e2e specs: launching the real app against a temp user
 * data dir, selecting a collection, addressing tree rows, stubbing the native
 * folder picker, and holding a main-process IPC handler behind a gate.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expect, _electron: electron } = require('@playwright/test');
const { APP_ENTRY } = require('./app-entry.js');
const { wrapHandler } = require('./ipc-wrap.js');

// A fresh user data dir named mitate-<label>-XXXXXX under os.tmpdir().
function newUserDataDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `mitate-${label}-`));
}

async function launchApp(userDataDir) {
  const app = await electron.launch({
    args: [APP_ENTRY, `--user-data-dir=${userDataDir}`],
    cwd: path.join(__dirname, '..', '..'),
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

const rowAt = (window, p) => window.locator(`[data-testid="tree-row"][data-path="${p}"]`);

// Clicks the only collection in the list and waits for its tree.
async function selectOnlyCollection(window) {
  await expect(window.getByTestId('collection-item')).toHaveCount(1, { timeout: 30000 });
  await window.getByTestId('collection-item').click();
  await expect(window.getByTestId('tree-row').first()).toBeVisible({ timeout: 30000 });
}

// Replaces dialog.showOpenDialog in the main process with a stub that returns
// `paths`. Returns readers for what the stub saw: the number of calls, the
// options of the last call, and whether its parent was the app window (the
// window has no focus in a background run, as when the user clicked elsewhere).
async function stubFolderPicker(app, paths) {
  await app.evaluate(({ dialog }, folderPaths) => {
    const seen = (globalThis.__pickerStub = { calls: 0, lastOptions: null, parentIsAppWindow: null });
    dialog.showOpenDialog = async (...args) => {
      seen.calls += 1;
      seen.lastOptions = args[args.length - 1];
      const parent = args.length > 1 ? args[0] : null;
      seen.parentIsAppWindow =
        parent !== null &&
        !parent.isDestroyed() &&
        parent.webContents.getURL().endsWith('/src/renderer/index.html');
      return { canceled: false, filePaths: folderPaths };
    };
  }, paths);
  const read = (field) => app.evaluate((_electron, f) => globalThis.__pickerStub[f], field);
  return {
    calls: () => read('calls'),
    lastOptions: () => read('lastOptions'),
    parentIsAppWindow: () => read('parentIsAppWindow'),
  };
}

// Serialised into the main process by wrapHandler, so these two are
// self-contained. State lives in globalThis.__moGates[channel].
const holdAll = (original, channel) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const state = { calls: 0, release };
  (globalThis.__moGates = globalThis.__moGates || {})[channel] = state;
  return async (event, ...args) => {
    state.calls += 1;
    await gate;
    return original(event, ...args);
  };
};

// One gate per first argument (a collection id); releasing before the call
// arrives lets that call through at once.
const holdPerKey = (original, channel) => {
  const gates = {};
  const gateOf = (key) => {
    if (!gates[key]) {
      gates[key] = { called: false, done: false };
      gates[key].promise = new Promise((resolve) => { gates[key].resolve = resolve; });
    }
    return gates[key];
  };
  const state = {
    calls: 0,
    release: (key) => gateOf(key).resolve(),
    pending: (key) => gateOf(key).called,
    done: (key) => gateOf(key).done,
  };
  (globalThis.__moGates = globalThis.__moGates || {})[channel] = state;
  return async (event, key, ...args) => {
    state.calls += 1;
    const gate = gateOf(key);
    gate.called = true;
    await gate.promise;
    const result = await original(event, key, ...args);
    gate.done = true;
    return result;
  };
};

// Holds every call to the main-process handler of `channel` until released.
// Without options one gate covers all calls: { calls(), release() }.
// With { keyed: true } each first argument has its own gate:
// { calls(), release(key), pending(key), done(key) } (pending: a call for key
// has arrived; done: its reply has been produced).
async function gateChannel(app, channel, { keyed = false } = {}) {
  await wrapHandler(app, channel, keyed ? holdPerKey : holdAll);
  const call = (method, key) =>
    app.evaluate((_electron, { c, m, k }) => {
      const state = globalThis.__moGates[c];
      return typeof state[m] === 'function' ? state[m](k) : state[m];
    }, { c: channel, m: method, k: key });
  return {
    calls: () => call('calls'),
    release: (key) => call('release', key),
    pending: (key) => call('pending', key),
    done: (key) => call('done', key),
  };
}

module.exports = { newUserDataDir, launchApp, rowAt, selectOnlyCollection, stubFolderPicker, gateChannel };
