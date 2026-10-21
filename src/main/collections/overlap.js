'use strict';

// Classifies a folder being added against a collection's existing folders, and
// words the refusal, replace and dropped-picks texts. Pure apart from the
// injected `realpath` (default fs.realpathSync); it shows no dialog, it only
// returns text and lists.
//
// Both sides are resolved first: realpath, or path.resolve when realpath throws
// (for example the folder does not exist). Comparison is then by whole segments,
// case-insensitive, via src/shared/path-compare.js.
//
// findOverlaps returns { covered, coveredCount, identical, contains }:
//   covered      the first existing folder (in the given order) that the
//                candidate is inside or identical to, or null
//   coveredCount how many existing folders cover the candidate
//   identical    true when `covered` is the same path as the candidate, not a
//                parent of it (false when covered is null)
//   contains     existing folders that lie inside the candidate, in given order
// Folders are reported as they were given, not as resolved.
//
// FR-8 (revised 2026-10-21):
//   describeRefusal(result, candidatePath)  text when the candidate is inside or
//       identical to an existing folder (inside wins over contains), else null
//   describeReplace(result, candidatePath)  { message, detail } when the candidate
//       only contains existing folders (they will be replaced), else null
//   dropNested(picks, { realpath })         { kept, dropped: [{ path, coveredBy }] }
//       drops every pick that is inside another pick, or identical to an earlier
//       one; coveredBy is the kept outermost pick; order follows the picks
//   describeDropped(dropped)                notice text, or null for an empty list

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
  let identical = false;
  const contains = [];
  for (const existing of existingPaths || []) {
    const resolved = resolveWith(realpath, existing);
    const rel = PathCompare.compare(candidate, resolved);
    if (rel.same || rel.inside) {
      if (coveredBy.length === 0) identical = rel.same;
      coveredBy.push(existing);
    }
    else if (rel.contains) contains.push(existing);
  }
  return {
    covered: coveredBy.length > 0 ? coveredBy[0] : null,
    coveredCount: coveredBy.length,
    identical,
    contains,
  };
}

const NO_FILES_TOUCHED = 'No files on disk are touched, deleted or moved.';

function describeRefusal(result, candidatePath) {
  if (!result || result.covered === null || result.covered === undefined) return null;
  const n = result.coveredCount || 1;
  const more = n > 1 ? ` (and ${n - 1} other ${n - 1 === 1 ? 'folder' : 'folders'})` : '';
  if (result.identical) {
    const as = result.covered === candidatePath ? '' : ` as ${result.covered}`;
    return `${candidatePath} is already in the collection${as}${more}.`;
  }
  return `${candidatePath} is already covered by ${result.covered}${more}.`;
}

function describeReplace(result, candidatePath) {
  if (!result) return null;
  const hasCovered = result.covered !== null && result.covered !== undefined;
  const inner = result.contains || [];
  if (hasCovered || inner.length === 0) return null;
  return {
    message: 'Add this folder and replace the folders it contains?',
    detail: `${candidatePath} contains ${inner.length === 1 ? 'a folder' : `${inner.length} folders`} `
      + `already in this collection. ${inner.length === 1 ? 'This folder' : 'These folders'} `
      + `will be replaced by it: ${inner.join(', ')}. ${NO_FILES_TOUCHED}`,
  };
}

function dropNested(picks, { realpath = fs.realpathSync } = {}) {
  const list = picks || [];
  const resolved = list.map((p) => resolveWith(realpath, p));
  const isDropped = list.map((_, i) => resolved.some((other, j) => {
    if (j === i) return false;
    const rel = PathCompare.compare(resolved[i], other);
    return rel.inside || (rel.same && j < i);
  }));
  const kept = list.filter((_, i) => !isDropped[i]);
  const dropped = [];
  list.forEach((pick, i) => {
    if (!isDropped[i]) return;
    const k = list.findIndex((_, j) => {
      if (isDropped[j]) return false;
      const rel = PathCompare.compare(resolved[i], resolved[j]);
      return rel.same || rel.inside;
    });
    dropped.push({ path: pick, coveredBy: list[k] });
  });
  return { kept, dropped };
}

function describeDropped(dropped) {
  if (!Array.isArray(dropped) || dropped.length === 0) return null;
  const lines = dropped.map((d) => `${d.path} (covered by ${d.coveredBy})`);
  return `Left out because another picked folder already covers ${dropped.length === 1 ? 'it' : 'them'}: ${lines.join('; ')}.`;
}

module.exports = { findOverlaps, describeRefusal, describeReplace, dropNested, describeDropped };
