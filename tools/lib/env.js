'use strict';
// Environment and statistics helpers shared by the measurement tools. Plain Node, no dependencies.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

// { min, median, max } of a non-empty list of numbers.
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min: sorted[0], median, max: sorted[sorted.length - 1] };
}

// Trimmed stdout of a command; on failure the string "unavailable (<first line of the error>)".
function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch (err) {
    return `unavailable (${err.message.split('\n')[0]})`;
  }
}

function electronVersion() {
  const installed = path.join(ROOT, 'node_modules', 'electron', 'package.json');
  if (fs.existsSync(installed)) {
    return `${JSON.parse(fs.readFileSync(installed, 'utf8')).version} (node_modules/electron/package.json)`;
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const range = (pkg.devDependencies && pkg.devDependencies.electron) || (pkg.dependencies && pkg.dependencies.electron);
  return `node_modules/electron not present; package.json declares "${range}"`;
}

// { df, mount } for the volume holding dir: the `df -P` output on one line, and the
// `mount` line of the device named on df's last data line.
function filesystemOf(dir) {
  const df = sh('df', ['-P', dir]).split('\n');
  const device = (df[df.length - 1] || '').split(/\s+/)[0];
  const line = sh('mount', []).split('\n').find((l) => device && l.startsWith(`${device} on `));
  return { df: df.join(' | '), mount: line || `no mount line starting with "${device} on "` };
}

module.exports = { ROOT, stats, sh, electronVersion, filesystemOf };
