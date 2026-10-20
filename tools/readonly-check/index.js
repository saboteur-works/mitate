'use strict';

// Reusable read-only check for any feature's tests (FR-14, FR-15).
//
//   const before = snapshot(dir, { role: 'before' });
//   ...run the app flow...
//   const after = snapshot(dir, { role: 'after' });
//   assert(before, after);                        // throws on non-atime differences
//   assert(before, after, { failOnAtime: true }); // atime differences also throw

const { snapshot } = require('./snapshot');
const { compare, hasNonAtimeDifferences, describe } = require('./compare');

/**
 * Compare two snapshots and throw if the tree changed. Access-time differences
 * are always in the returned result's `atime` list; they throw only when
 * options.failOnAtime is true (default false). The thrown Error carries the
 * compare result as `.diff`. Returns the compare result when it does not throw.
 */
function assert(before, after, options = {}) {
  const failOnAtime = options.failOnAtime === true;
  const diff = compare(before, after);
  const fail = hasNonAtimeDifferences(diff) || (failOnAtime && diff.atime.length > 0);
  if (fail) {
    const err = new Error(`read-only check failed:\n${describe(diff, failOnAtime)}`);
    err.diff = diff;
    throw err;
  }
  return diff;
}

module.exports = { snapshot, compare, assert };
