'use strict';

// Package bundle detection (FR-7, OQ-5). A package is a directory whose name
// ends in one of these extensions. The list is the single place to extend;
// the macOS package attribute is deliberately not consulted.

const PACKAGE_EXTENSIONS = Object.freeze(['.app', '.photoslibrary', '.bundle', '.framework', '.rtfd']);

/** True when a directory name ends in a package extension (case-insensitive). */
function isPackageName(dirName) {
  if (typeof dirName !== 'string') return false;
  const lower = dirName.toLowerCase();
  return PACKAGE_EXTENSIONS.some((ext) => lower.length > ext.length && lower.endsWith(ext));
}

module.exports = { PACKAGE_EXTENSIONS, isPackageName };
