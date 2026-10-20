'use strict';

// Classifies a folder being added against a collection's existing folders, and
// words the confirmation text. Pure apart from the injected `realpath`
// (default fs.realpathSync); it shows no dialog, it only returns text.
//
// Both sides are resolved first: realpath, or path.resolve when realpath throws
// (for example the folder does not exist). Comparison is then by whole segments,
// case-insensitive, via src/shared/path-compare.js.
//
// findOverlaps returns { covered, coveredCount, contains }:
//   covered      the first existing folder (in the given order) that the
//                candidate is inside or identical to, or null
//   coveredCount how many existing folders cover the candidate
//   contains     existing folders that lie inside the candidate, in given order
// Folders are reported as they were given, not as resolved.

const fs = require('node:fs');
const path = require('node:path');
const PathCompare = require('../../shared/path-compare.js');

function resolveWith(realpath, p) {
  try {
    return realpath(p);
  } catch (_) {
    return path.resolve(p);
  }
}

function findOverlaps(candidatePath, existingPaths, { realpath = fs.realpathSync } = {}) {
  const candidate = resolveWith(realpath, candidatePath);
  const coveredBy = [];
  const contains = [];
  for (const existing of existingPaths || []) {
    const resolved = resolveWith(realpath, existing);
    const rel = PathCompare.compare(candidate, resolved);
    if (rel.same || rel.inside) coveredBy.push(existing);
    else if (rel.contains) contains.push(existing);
  }
  return {
    covered: coveredBy.length > 0 ? coveredBy[0] : null,
    coveredCount: coveredBy.length,
    contains,
  };
}

function describeOverlap(result, candidatePath) {
  if (!result) return null;
  const hasCovered = result.covered !== null && result.covered !== undefined;
  const inner = result.contains || [];
  if (!hasCovered && inner.length === 0) return null;

  const clauses = [];
  if (hasCovered) {
    const n = result.coveredCount || 1;
    const more = n > 1 ? ` (and ${n - 1} other ${n - 1 === 1 ? 'folder' : 'folders'})` : '';
    clauses.push(`it is already covered by ${result.covered}${more}`);
  }
  if (inner.length > 0) {
    const more =
      inner.length > 1 ? ` (and ${inner.length - 1} more, ${inner.length} in total)` : '';
    clauses.push(
      `the collection already contains a folder inside the one being added: ${inner[0]}${more}`
    );
  }
  return `${candidatePath}: ${clauses.join('; ')}.`;
}

module.exports = { findOverlaps, describeOverlap };
