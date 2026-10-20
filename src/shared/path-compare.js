'use strict';

// Pure comparison of absolute path strings. No DOM, no Node modules (no path,
// fs or realpath), so it loads in both the main process and the renderer.
//
// POSIX separators only ("/", macOS first). Backslashes are ordinary
// characters. Comparison is by whole segments and case-insensitive. Symlinks
// are not resolved here; this is a string comparison only.
//
// normalize collapses repeated separators, drops "." segments, resolves ".."
// segments (never above the root) and removes a trailing separator. It keeps
// the original case. A non-string, empty or relative path normalises to null,
// and every comparison involving null answers false.

function segmentsOf(p) {
  if (typeof p !== 'string' || p.charAt(0) !== '/') return null;
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out;
}

function normalize(p) {
  const segs = segmentsOf(p);
  return segs === null ? null : '/' + segs.join('/');
}

function keyOf(p) {
  const segs = segmentsOf(p);
  return segs === null ? null : segs.map((s) => s.toLowerCase());
}

function isPrefix(shorter, longer) {
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[i]) return false;
  }
  return true;
}

// Same path (after normalisation and case folding).
function isSame(a, b) {
  const ka = keyOf(a);
  const kb = keyOf(b);
  if (ka === null || kb === null) return false;
  return ka.length === kb.length && isPrefix(ka, kb);
}

// True when `child` is strictly inside `parent`. Identical paths are not inside.
function isInside(child, parent) {
  const kc = keyOf(child);
  const kp = keyOf(parent);
  if (kc === null || kp === null) return false;
  return kc.length > kp.length && isPrefix(kp, kc);
}

// True when `parent` strictly contains `child`.
function contains(parent, child) {
  return isInside(child, parent);
}

// { same, inside, contains } describing how `a` relates to `b`.
function compare(a, b) {
  return { same: isSame(a, b), inside: isInside(a, b), contains: contains(a, b) };
}

const PathCompare = { normalize, isSame, isInside, contains, compare };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PathCompare;
} else {
  globalThis.PathCompare = PathCompare;
}
