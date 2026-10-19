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

const UNCHANGED = 'The file has not been changed.';

// Describes why the store could not be opened, by the kind of failure.
function describeFailure(error, file) {
  const detail = error && error.message ? error.message : String(error);
  const code = error && error.code;
  if (code === 'STORE_FORMAT_UNSUPPORTED') {
    const found = error.foundVersion;
    const supported = error.supportedVersion;
    if (found === undefined) {
      return `The data file ${file} is not in a format this app recognizes. ${UNCHANGED} Restore it from a backup.`;
    }
    if (found > supported) {
      return (
        `The data file ${file} was written by a newer version of this app (format ${found}; ` +
        `this version reads format ${supported}). ${UNCHANGED} Install a newer version of the app to open it.`
      );
    }
    return (
      `The data file ${file} uses an older data format (format ${found}) that this version of the app ` +
      `cannot open (it reads format ${supported}). ${UNCHANGED}`
    );
  }
  if (error instanceof SyntaxError) {
    return `The data file ${file} is not valid JSON (${detail}) and may be damaged. ${UNCHANGED} Restore it from a backup.`;
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return `The data file ${file} could not be read: permission denied (${code}). ${UNCHANGED} Check the file's permissions.`;
  }
  return `The data file ${file} could not be opened (${detail}). ${UNCHANGED}`;
}

async function startStorage({ baseDir, openStorage, reportError }) {
  try {
    const storage = openStorage({ location: { baseDir } });
    return { ok: true, storage };
  } catch (error) {
    const message = describeFailure(error, path.join(baseDir, STORE_FILE_NAME));
    try {
      await reportError(message);
    } catch (reportFailure) {
      // Reporting must not turn a handled failure into a crash.
    }
    return { ok: false, error };
  }
}

module.exports = { startStorage };
