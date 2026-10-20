'use strict';

/*
 * In-flight guard. Main-process logic with no Electron imports. Tracks which
 * collections have a long-running operation (rescan, add-folder scan, ...) so
 * that two operations on one collection exclude each other.
 *
 *   createInFlightGuard()
 *     acquire(collectionId, kind) -> release()
 *       Throws an Error with `code === 'COLLECTION_BUSY'` (message names the
 *       holding kind) when the collection is already held. Other collections
 *       are not affected.
 *     isBusy(collectionId) -> boolean
 *     holder(collectionId)  -> the holding kind, or undefined
 *
 * Decisions:
 * - release is idempotent and token-based: calling it twice is harmless, and a
 *   stale release never frees a later holder of the same collection.
 */

const COLLECTION_BUSY = 'COLLECTION_BUSY';

function createInFlightGuard() {
  const held = new Map(); // collectionId -> { kind, token }

  function acquire(collectionId, kind) {
    const current = held.get(collectionId);
    if (current) {
      const err = new Error(`Collection is busy: ${current.kind} in progress`);
      err.code = COLLECTION_BUSY;
      throw err;
    }
    const token = {};
    held.set(collectionId, { kind, token });
    return function release() {
      const entry = held.get(collectionId);
      if (entry && entry.token === token) held.delete(collectionId);
    };
  }

  return {
    acquire,
    isBusy: (collectionId) => held.has(collectionId),
    holder: (collectionId) => held.get(collectionId)?.kind,
  };
}

module.exports = { createInFlightGuard, COLLECTION_BUSY };
