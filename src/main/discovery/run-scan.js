'use strict';

/*
 * Runs discovery in a worker thread so the UI/main event loop stays free
 * during a scan (FR-12). Results are delivered when the scan completes.
 *
 *   runScan(folderPath, { onError? })           -> Promise<FileRecord[]>
 *   runScanWithInfo(folderPath, { onError? })   -> Promise<{ records, threadId }>
 *
 * The records equal discoverSync(folderPath)'s output. opts.onError(err, path)
 * receives unreadable-subdirectory warnings (err has message and code).
 * If the root cannot be read (or is not an absolute path) the promise rejects
 * with an Error whose message names the folder and whose `code` is the
 * original errno code, so callers can mark the folder unavailable (FR-4).
 * The worker is terminated when the scan settles.
 */

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, 'worker.js');

function scanError(folderPath, info) {
  const err = new Error(`Cannot scan folder "${folderPath}": ${info.message}`);
  if (info.code) err.code = info.code;
  err.folderPath = folderPath;
  return err;
}

function runScanWithInfo(folderPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: { folderPath } });
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => {});
      fn(value);
    };

    worker.on('message', (msg) => {
      if (msg.type === 'warning') {
        if (opts.onError) {
          const err = new Error(msg.message);
          if (msg.code) err.code = msg.code;
          opts.onError(err, msg.path);
        }
      } else if (msg.type === 'done') {
        settle(resolve, { records: msg.records, threadId: msg.threadId });
      } else if (msg.type === 'error') {
        settle(reject, scanError(folderPath, msg.error));
      }
    });
    worker.on('error', (err) => settle(reject, scanError(folderPath, err)));
    worker.on('exit', (code) =>
      settle(reject, scanError(folderPath, { message: `worker exited with code ${code}` })),
    );
  });
}

async function runScan(folderPath, opts = {}) {
  return (await runScanWithInfo(folderPath, opts)).records;
}

module.exports = { runScan, runScanWithInfo };
