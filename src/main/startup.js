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
 * Failure (openStorage throws: STORE_OPEN_FAILED with reason 'corrupt',
 * 'unsupported-format' or 'unreadable', or any other error): calls reportError once with a message
 * naming the store file and the problem, then resolves { ok: false, error }.
 * It never throws, and it never writes, overwrites, deletes or renames the
 * store file; opening only reads it. The caller must not build services or
 * register IPC from a failed result.
 */

const { resolveStorageFile } = require('./storage/index.js');
const { messageOf } = require('./message-of.js');

const UNCHANGED = 'The file has not been changed.';

// Describes why the store could not be opened, by the storage error's reason.
function describeFailure(error, file) {
  const reason = error && error.code === 'STORE_OPEN_FAILED' ? error.reason : undefined;
  const cause = (error && error.cause) || error;
  const detail = messageOf(cause);
  if (reason === 'unsupported-format') {
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
  if (reason === 'corrupt') {
    return `The data file ${file} is not valid JSON (${detail}) and may be damaged. ${UNCHANGED} Restore it from a backup.`;
  }
  const code = cause && cause.code;
  if (reason === 'unreadable' && (code === 'EACCES' || code === 'EPERM')) {
    return `The data file ${file} could not be read: permission denied (${code}). ${UNCHANGED} Check the file's permissions.`;
  }
  return `The data file ${file} could not be opened (${detail}). ${UNCHANGED}`;
}

// The store file named by the error, else the one the storage module resolves
// for this baseDir (errors that are not open failures, e.g. a bad location).
function storeFileOf(error, baseDir) {
  if (error && error.file) return error.file;
  try {
    return resolveStorageFile({ location: { baseDir } });
  } catch {
    return String(baseDir);
  }
}

async function startStorage({ baseDir, openStorage, reportError }) {
  try {
    const storage = openStorage({ location: { baseDir } });
    return { ok: true, storage };
  } catch (error) {
    const message = describeFailure(error, storeFileOf(error, baseDir));
    try {
      await reportError(message);
    } catch (reportFailure) {
      // Reporting must not turn a handled failure into a crash.
    }
    return { ok: false, error };
  }
}

module.exports = { startStorage };
