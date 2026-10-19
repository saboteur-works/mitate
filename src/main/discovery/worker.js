'use strict';

/*
 * Worker-thread entry for discovery (FR-12). Started by run-scan.js with
 * workerData = { folderPath }. Messages posted to the parent:
 *   { type: 'warning', message, code, path }   per unreadable subdirectory
 *   { type: 'done', records, threadId, isMainThread }
 *   { type: 'error', error: { message, code, name } }   unreadable root, bad input
 * Pure Node, no Electron.
 */

const { parentPort, workerData, threadId, isMainThread } = require('node:worker_threads');
const { discoverSync } = require('./discover.js');

function run() {
  try {
    const records = discoverSync(workerData.folderPath, {
      onError: (err, dir) =>
        parentPort.postMessage({ type: 'warning', message: err.message, code: err.code, path: dir }),
    });
    parentPort.postMessage({ type: 'done', records, threadId, isMainThread });
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      error: { message: err.message, code: err.code, name: err.name },
    });
  }
}

run();
