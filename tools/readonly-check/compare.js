'use strict';

// Read-only check, part 2: compare two snapshots.

const FIELDS = ['type', 'size', 'mode', 'contentHash', 'mtimeNs', 'ctimeNs', 'birthtimeNs'];

function differingFields(a, b) {
  const fields = FIELDS.filter((f) => a[f] !== b[f]);
  const names = new Set([...Object.keys(a.xattrs), ...Object.keys(b.xattrs)]);
  for (const name of [...names].sort()) {
    if (a.xattrs[name] !== b.xattrs[name]) fields.push(`xattr:${name}`);
  }
  return fields;
}

/**
 * Compare two snapshots. Returns:
 *   added:   [relPath]                      present only in `after`
 *   removed: [relPath]                      present only in `before`
 *   changed: [{ path, fields, before, after }]
 *            fields names every differing field other than atime
 *            ('type','size','mode','contentHash','mtimeNs','ctimeNs',
 *            'birthtimeNs', or 'xattr:<name>'); before/after hold the entries.
 *   atime:   [{ path, before, after }]      atimeNs differences, reported
 *            separately; an atime-only difference is never listed in `changed`.
 * A rename appears as one removed and one added path.
 */
function compare(before, after) {
  const result = { added: [], removed: [], changed: [], atime: [] };
  const a = before.entries;
  const b = after.entries;
  for (const rel of Object.keys(a).sort()) {
    if (!(rel in b)) {
      result.removed.push(rel);
      continue;
    }
    const fields = differingFields(a[rel], b[rel]);
    if (fields.length > 0) {
      result.changed.push({ path: rel, fields, before: a[rel], after: b[rel] });
    }
    if (a[rel].atimeNs !== b[rel].atimeNs) {
      result.atime.push({ path: rel, before: a[rel].atimeNs, after: b[rel].atimeNs });
    }
  }
  for (const rel of Object.keys(b).sort()) {
    if (!(rel in a)) result.added.push(rel);
  }
  return result;
}

function hasNonAtimeDifferences(diff) {
  return diff.added.length + diff.removed.length + diff.changed.length > 0;
}

function describe(diff, includeAtime) {
  const lines = [];
  for (const p of diff.added) lines.push(`added: ${p}`);
  for (const p of diff.removed) lines.push(`removed: ${p}`);
  for (const c of diff.changed) lines.push(`changed: ${c.path} (${c.fields.join(', ')})`);
  if (includeAtime) for (const t of diff.atime) lines.push(`atime: ${t.path}`);
  return lines.join('\n');
}

module.exports = { compare, hasNonAtimeDifferences, describe };
