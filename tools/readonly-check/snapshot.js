'use strict';

// Read-only check, part 1: snapshot a directory tree without modifying it.
// Entries are read with lstat so symlinks are recorded as symlinks and never
// followed. Extended attributes are read through the macOS `xattr` CLI.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROLES = ['before', 'after'];
const CHUNK = 1024 * 1024;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let n;
    while ((n = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function runXattr(args) {
  return execFileSync('xattr', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Returns { name: sha256-of-hex-value } for every extended attribute of an
// entry. `-s` makes xattr act on a symlink itself instead of its target.
function readXattrs(file) {
  const out = Object.create(null);
  const names = runXattr(['-s', file]).split('\n').filter((n) => n.length > 0);
  for (const name of names.sort()) {
    out[name] = sha256(runXattr(['-s', '-p', '-x', name, file]));
  }
  return out;
}

function entryType(st) {
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'directory';
  if (st.isFile()) return 'file';
  return 'other';
}

function statRecord(abs) {
  const st = fs.lstatSync(abs, { bigint: true });
  return {
    type: entryType(st),
    size: st.size.toString(),
    mode: (Number(st.mode) & 0o7777).toString(8),
    mtimeNs: st.mtimeNs.toString(),
    ctimeNs: st.ctimeNs.toString(),
    birthtimeNs: st.birthtimeNs.toString(),
    atimeNs: st.atimeNs.toString(),
  };
}

function absOf(root, rel) {
  return rel === '.' ? root : path.join(root, rel);
}

// Phase 1: enumerate entries. Each entry is lstat-ed before its own directory
// listing is read, so a directory's atime is recorded before this walk reads it.
function walk(root) {
  const entries = Object.create(null);
  const visit = (rel) => {
    const abs = absOf(root, rel);
    const rec = statRecord(abs);
    entries[rel] = rec;
    if (rec.type !== 'directory') return;
    for (const name of fs.readdirSync(abs).sort()) {
      visit(rel === '.' ? name : path.join(rel, name));
    }
  };
  visit('.');
  return entries;
}

// Phase 2: content hashes and xattrs.
function fillContent(root, entries) {
  for (const rel of Object.keys(entries)) {
    const rec = entries[rel];
    const abs = absOf(root, rel);
    if (rec.type === 'file') {
      rec.contentHash = hashFile(abs);
    } else if (rec.type === 'symlink') {
      rec.contentHash = sha256(fs.readlinkSync(abs));
    } else {
      rec.contentHash = null;
    }
    rec.xattrs = readXattrs(abs);
  }
}

function refreshAtime(root, entries) {
  for (const rel of Object.keys(entries)) {
    entries[rel].atimeNs = statRecord(absOf(root, rel)).atimeNs;
  }
}

/**
 * Snapshot a directory tree.
 *
 * options.role selects the access-time ordering (FR-15):
 *   'before' (default): atime is re-read AFTER all content hashing and
 *            xattr reads, so the snapshot's own reads are excluded.
 *   'after': atime is the value read BEFORE any content hashing or xattr
 *            reads (and before each directory's own listing).
 *
 * Returns { root, role, entries } where entries maps relative path ('.' for
 * the root) to { type, size, mode, mtimeNs, ctimeNs, birthtimeNs, atimeNs,
 * contentHash, xattrs }. Times are nanosecond strings; mode is octal text.
 */
function snapshot(root, options = {}) {
  const role = options.role === undefined ? 'before' : options.role;
  if (!ROLES.includes(role)) {
    throw new Error(`snapshot: role must be one of ${ROLES.join(', ')}, got ${String(role)}`);
  }
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('snapshot: root must be a non-empty path string');
  }
  const abs = path.resolve(root);
  const entries = walk(abs);
  fillContent(abs, entries);
  if (role === 'before') refreshAtime(abs, entries);
  return { root: abs, role, entries };
}

module.exports = { snapshot, ROLES };
