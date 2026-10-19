'use strict';

/*
 * Startup storage opening (FR-2, FR-18).
 *
 * startStorage({ baseDir, openStorage, reportError }) -> Promise<result>
 *   baseDir      absolute directory holding store.json (main passes userData)
 *   openStorage  the storage module's openStorage (injected for testing)
 *   reportError  function(message: string) shown to the user; may be async
 *
 * Success: resolves { ok: true, storage }.
 * Failure (openStorage throws: invalid JSON, a version other than the
 * supported one, unreadable file, ...): calls reportError once with a message
 * naming the store file and the problem, then resolves { ok: false, error }.
 * It never throws, and it never writes, overwrites, deletes or renames the
 * store file; opening only reads it. The caller must not build services or
 * register IPC from a failed result.
 */

const path = require('node:path');

const STORE_FILE_NAME = 'store.json';

async function startStorage({ baseDir, openStorage, reportError }) {
  try {
    const storage = openStorage({ location: { baseDir } });
    return { ok: true, storage };
  } catch (error) {
    const file = path.join(baseDir, STORE_FILE_NAME);
    const detail = error && error.message ? error.message : String(error);
    const message =
      `The data file ${file} could not be opened (${detail}). ` +
      'It is corrupt or was written by a newer version of this app. ' +
      'The file has not been changed. Restore it from a backup or install a newer version.';
    try {
      await reportError(message);
    } catch (reportFailure) {
      // Reporting must not turn a handled failure into a crash.
    }
    return { ok: false, error };
  }
}

module.exports = { startStorage };
