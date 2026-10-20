#!/usr/bin/env node
'use strict';
// FR-21 access-time measurement. Plain Node, no dependencies.
// Usage: node tools/atime-measurement/measure.js <volume-path> --label <internal-apfs|external|network>

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { filesystemOf } = require('../lib/env.js');

const LABELS = ['internal-apfs', 'external', 'network'];
const WAIT_MS = 1100;
const RESULT_FILE = path.resolve(__dirname, '..', '..', 'docs', 'measurements', 'atime-cat-read.md');
const NOT_MEASURED = 'not measured: no such volume available to this run; requires the user\'s hardware';

function header() {
  return [
    '# Access-time measurement: plain `cat` read (FR-21)',
    '',
    'Each record is one run of `node tools/atime-measurement/measure.js <volume-path> --label <label>`.',
    'The script creates a fixture file in a fresh temp subdirectory of the volume path, waits, records atime,',
    'reads the file with `cat` (stdout discarded), records atime again, and removes the directory.',
    'This file records only what was measured.',
    '',
  ].join('\n');
}

function initialContent() {
  const sections = LABELS.map((l) => `## ${l}\n\n${NOT_MEASURED}\n`);
  return `${header()}\n${sections.join('\n')}`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let volume = null;
  let label = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label') label = args[++i];
    else if (volume === null) volume = args[i];
    else throw new Error(`unexpected argument: ${args[i]}`);
  }
  if (!volume) throw new Error('missing <volume-path>');
  if (!LABELS.includes(label)) throw new Error(`--label must be one of ${LABELS.join(', ')}`);
  return { volume: path.resolve(volume), label };
}

function iso(ns) {
  // Full ISO timestamp with nanosecond precision from a bigint nanosecond count.
  const ms = ns / 1000000n;
  const rem = (ns % 1000000000n).toString().padStart(9, '0');
  return new Date(Number(ms)).toISOString().replace(/\.\d{3}Z$/, `.${rem}Z`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function measure(volume) {
  const dir = fs.mkdtempSync(path.join(volume, 'atime-measure-'));
  try {
    const file = path.join(dir, 'fixture.txt');
    fs.writeFileSync(file, 'atime measurement fixture\n'.repeat(64));
    const fsInfo = filesystemOf(dir);
    sleep(WAIT_MS);
    const before = fs.statSync(file, { bigint: true }).atimeNs;
    const r = spawnSync('cat', [file], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status !== 0) throw new Error(`cat exited ${r.status}: ${r.stderr}`);
    const after = fs.statSync(file, { bigint: true }).atimeNs;
    return { dir, fsInfo, before: iso(before), after: iso(after), differ: before !== after };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function formatRecord(label, volume, m) {
  return [
    `### Record ${new Date().toISOString()}`,
    '',
    `- label: ${label}`,
    `- path: ${m.dir}`,
    `- volume-path argument: ${volume}`,
    `- df -P: ${m.fsInfo.df}`,
    `- filesystem type (from mount output): ${m.fsInfo.mount}`,
    `- wait between create and read: ${WAIT_MS} ms`,
    `- atime before: ${m.before}`,
    `- atime after: ${m.after}`,
    `- atime differs: ${m.differ ? 'yes' : 'no'}`,
    '',
  ].join('\n');
}

function appendRecord(label, record) {
  let content = fs.existsSync(RESULT_FILE) ? fs.readFileSync(RESULT_FILE, 'utf8') : initialContent();
  const marker = `## ${label}\n`;
  const start = content.indexOf(marker);
  if (start < 0) throw new Error(`section "${label}" not found in ${RESULT_FILE}`);
  const bodyStart = start + marker.length;
  const next = content.indexOf('\n## ', bodyStart);
  const end = next < 0 ? content.length : next + 1;
  let body = content.slice(bodyStart, end).replace(`\n${NOT_MEASURED}\n`, '\n');
  body = `\n${record}`;
  const tail = next < 0 ? '' : '\n';
  content = content.slice(0, bodyStart) + body + tail + content.slice(end);
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, content);
}

function main() {
  const { volume, label } = parseArgs(process.argv);
  if (!fs.statSync(volume).isDirectory()) throw new Error(`not a directory: ${volume}`);
  const m = measure(volume);
  appendRecord(label, formatRecord(label, volume, m));
  console.log(`${label}: atime before ${m.before}, after ${m.after}, differs: ${m.differ}`);
}

try {
  main();
} catch (e) {
  console.error(`measure.js: ${e.message}`);
  process.exit(1);
}
