'use strict';

// Pure comparison of absolute path strings. No DOM, no Node modules (no path,
// fs or realpath), so it loads in both the main process and the renderer.
//
// POSIX separators only ("/", macOS first). Backslashes are ordinary
// characters. Comparison is by whole segments and case-sensitive. Symlinks
// and the on-disk case are not resolved here; callers canonicalise first
// (overlap.js uses fs.realpathSync.native). This is a string comparison only.
//
// normalize collapses repeated separators, drops "." segments, resolves ".."
// segments (never above the root) and removes a trailing separator. It keeps
// the original case. A non-string, empty or relative path normalises to null,
// and every comparison involving null answers false.

// The body is wrapped so a classic <script> load leaks only `PathCompare`
// (a top-level declaration would collide with other renderer scripts).
(function () {
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
    return segs;
  }

  function isPrefix(shorter, longer) {
    for (let i = 0; i < shorter.length; i++) {
      if (shorter[i] !== longer[i]) return false;
    }
    return true;
  }

  // Same path (after normalisation).
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
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === null || kb === null) return { same: false, inside: false, contains: false };
    return {
      same: ka.length === kb.length && isPrefix(ka, kb),
      inside: ka.length > kb.length && isPrefix(kb, ka),
      contains: kb.length > ka.length && isPrefix(ka, kb),
    };
  }

  const PathCompare = { normalize, isSame, isInside, contains, compare };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PathCompare;
  } else {
    globalThis.PathCompare = PathCompare;
  }
})();
