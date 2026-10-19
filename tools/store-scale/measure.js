#!/usr/bin/env node
'use strict';

/*
 * Measurement (FR-18): cost of the JSON storage module at 50,000, 200,000 and
 * 500,000 file records. Not product code. Runs under plain Node, not inside
 * Electron. Writes docs/measurements/json-store-scale.md (facts only).
 *
 * Usage: node tools/store-scale/measure.js [--sizes 50000,200000,500000] [--runs 5]
 *
 * Per size, in a fresh temporary storage directory under os.tmpdir() (removed
 * afterwards):
 *   populate  one transaction: putCollection, 5 x putFolder, 5 x replaceFolderIndex
 *   size      fs.statSync(store.json).size
 *   load      openStorage({location:{file}}) on the existing populated store
 *   save      storage.setFolderUnavailable(folderId, false), one non-transactional
 *             mutator call; it persists the full state in one write
 *   txn       storage.transaction(fn) with 4 mutations (see MUTATIONS below)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStorage } = require('../../src/main/storage');
const { lookupExtension } = require('../../src/main/registry/types.js');
const { stats, sh, electronVersion } = require('../lib/env.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DOC = path.join(ROOT, 'docs', 'measurements', 'json-store-scale.md');
const FOLDER_COUNT = 5;
// Extensions of the generated records; kind and subtype come from the registry,
// as discovery produces them.
const EXTENSIONS = ['jpg', 'png', 'cr2', 'mp4', 'mov', 'wav', 'pdf', 'txt'];

function parseArgs(argv) {
  const out = { sizes: [50000, 200000, 500000], runs: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sizes') out.sizes = argv[++i].split(',').map(Number);
    else if (argv[i] === '--runs') out.runs = Number(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (out.sizes.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('bad --sizes');
  if (!Number.isInteger(out.runs) || out.runs < 5) throw new Error('--runs must be an integer >= 5');
  return out;
}

function folderRoot(n) {
  return `/Volumes/Media/Collection/Folder${n}`;
}

function makeRecords(count, folderN) {
  const base = folderRoot(folderN);
  const records = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const { extension: ext, kind, subtype } = lookupExtension(EXTENSIONS[(i * 7 + folderN) % EXTENSIONS.length]);
    const name = `IMG_${String(i).padStart(7, '0')}.${ext}`;
    const relativePath = `${2015 + (i % 10)}/${String(1 + (i % 12)).padStart(2, '0')}/event-${i % 200}/${name}`;
    const rec = {
      path: `${base}/${relativePath}`, relativePath, name, extension: ext, kind,
    };
    if (subtype) rec.subtype = subtype;
    records[i] = rec;
  }
  return records;
}

function populate(file, total) {
  const storage = openStorage({ location: { file } });
  const per = Math.floor(total / FOLDER_COUNT);
  storage.transaction(() => {
    storage.putCollection({ id: 'c1', name: 'Collection', folderIds: [], createdAt: new Date().toISOString() });
    for (let n = 0; n < FOLDER_COUNT; n += 1) {
      storage.putFolder({ id: `f${n}`, collectionId: 'c1', path: folderRoot(n) });
    }
    for (let n = 0; n < FOLDER_COUNT; n += 1) {
      const count = n === FOLDER_COUNT - 1 ? total - per * (FOLDER_COUNT - 1) : per;
      storage.replaceFolderIndex(`f${n}`, makeRecords(count, n));
    }
  });
  return storage;
}

function timeMs(fn) {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function measureSize(size, runs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-scale-'));
  const file = path.join(dir, 'store.json');
  try {
    const popMs = timeMs(() => populate(file, size));
    const bytes = fs.statSync(file).size;
    const load = [];
    for (let i = 0; i < runs; i += 1) load.push(timeMs(() => openStorage({ location: { file } })));
    const storage = openStorage({ location: { file } });
    const save = [];
    for (let i = 0; i < runs; i += 1) save.push(timeMs(() => storage.setFolderUnavailable('f0', false)));
    const txn = [];
    for (let i = 0; i < runs; i += 1) {
      txn.push(timeMs(() => storage.transaction(() => {
        storage.putCollection({ id: 'c1', name: `Collection ${i}`, folderIds: [], createdAt: '2026-01-01T00:00:00.000Z' });
        storage.setFolderUnavailable('f0', true);
        storage.setFolderUnavailable('f1', false);
        storage.setFolderAccess('f2', { bookmark: `run-${i}` });
      })));
    }
    return { size, bytes, popMs, load, save, txn, rss: process.memoryUsage().rss };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function withFallback(label, value, fallback) {
  if (!value.startsWith('unavailable')) return `${value} (${label})`;
  return `${label} failed to run in this environment; ${fallback}`;
}

const fmt = (n) => n.toFixed(2);
const list = (values) => values.map(fmt).join(', ');

function opSection(title, what, results, key) {
  const lines = [`### ${title}`, '', what, ''];
  lines.push('| size | runs (ms, in order) | min ms | median ms | max ms |', '|---|---|---|---|---|');
  for (const r of results) {
    const s = stats(r[key]);
    lines.push(`| ${r.size} | ${list(r[key])} | ${fmt(s.min)} | ${fmt(s.median)} | ${fmt(s.max)} |`);
  }
  return lines.join('\n');
}

function render(opts, results, elapsedS) {
  const cpus = os.cpus();
  const out = [
    '# JSON store scale measurement (FR-18)',
    '',
    `Produced by \`node tools/store-scale/measure.js\` (sizes ${opts.sizes.join(',')}; ${opts.runs} runs per size per operation).`,
    'This file records only what was measured.',
    '',
    '## Environment',
    '',
    `- date: ${new Date().toISOString()}`,
    `- machine model: ${withFallback('sysctl -n hw.model', sh('sysctl', ['-n', 'hw.model']), 'no other source used')}`,
    `- CPU: ${withFallback('sysctl -n machdep.cpu.brand_string', sh('sysctl', ['-n', 'machdep.cpu.brand_string']), `os.cpus()[0].model = ${cpus[0].model}`)}`,
    `- logical CPUs (os.cpus().length): ${cpus.length}`,
    `- RAM: ${withFallback('sysctl -n hw.memsize', sh('sysctl', ['-n', 'hw.memsize']), `os.totalmem() = ${os.totalmem()}`)} bytes`,
    `- OS (sw_vers): ${sh('sw_vers', []).replace(/\n/g, ' | ')}`,
    `- Node version (process.version): ${process.version}`,
    `- Electron version: ${electronVersion()}`,
    '- The script runs under plain Node, not inside Electron.',
    `- temporary storage location: a directory created with fs.mkdtempSync under os.tmpdir() (${os.tmpdir()}), outside any collection folder, removed after each size`,
    `- total script elapsed time: ${elapsedS.toFixed(1)} s`,
    '',
    '## Method',
    '',
    '- Module measured: src/main/storage/index.js (openStorage, transaction, setFolderUnavailable), called in-process.',
    '- FileRecord shape: folderId, collectionId (set by replaceFolderIndex), path (absolute), relativePath, name, extension, kind; subtype ("RAW" on the cr2 records). Extension, kind and subtype are taken from the supported-type registry, as discovery produces them.',
    '- Generated paths: `/Volumes/Media/Collection/Folder<n>/<year 2015-2024>/<month 01-12>/event-<0-199>/IMG_<7-digit index>.<ext>`; extensions jpg, png, cr2, mp4, mov, wav, pdf, txt. The files do not exist on disk.',
    `- Population: one collection, ${FOLDER_COUNT} folders, records split evenly across the folders (remainder in the last), written in a single storage.transaction.`,
    '- store.json size: fs.statSync size in bytes after population.',
    '- LOAD: time of `openStorage({ location: { file } })` on the existing populated store.json (reads and JSON.parses the file). Runs are repeated in the same process, so every run after the first executes with JIT-warm code; the individual values are listed in order.',
    '- SAVE: time of one `storage.setFolderUnavailable("f0", false)` call, a non-transactional mutator that persists the full state in one write-then-rename (the whole state is JSON.stringify-ed and written).',
    '- TRANSACTION: time of one `storage.transaction(fn)` call including its commit write, where fn performs 4 mutations: putCollection (rename the collection), setFolderUnavailable("f0", true), setFolderUnavailable("f1", false), setFolderAccess("f2", { bookmark }). The call includes the deep snapshot the module takes before fn.',
    '- Timing: process.hrtime.bigint around each call.',
    '- OS file cache: runs are repeated in the same process right after the store file was written, so the file was recently written. No cold-cache run was made; no cold-cache numbers are claimed.',
    '- Memory: `process.memoryUsage().rss` read once after all runs of a size, before that size\'s temporary directory was removed. It is the RSS of the whole process at that point, not a peak.',
    '',
    '## Results',
    '',
    '| size (file records) | store.json bytes | populate ms (single run) | process.memoryUsage().rss after the size (bytes) |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.size} | ${r.bytes} | ${fmt(r.popMs)} | ${r.rss} |`),
    '',
    opSection('Load', '`openStorage` on an existing populated store.', results, 'load'),
    '',
    opSection('Save', 'One `setFolderUnavailable("f0", false)` call (one full-state write).', results, 'save'),
    '',
    opSection('Transaction commit', 'One `transaction` call with 4 mutations (one full-state write).', results, 'txn'),
    '',
  ];
  return out.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const start = Date.now();
  const results = [];
  for (const size of opts.sizes) {
    console.log(`size ${size} ...`);
    results.push(measureSize(size, opts.runs));
    if (global.gc) global.gc();
  }
  fs.mkdirSync(path.dirname(DOC), { recursive: true });
  fs.writeFileSync(DOC, render(opts, results, (Date.now() - start) / 1000));
  console.log(`wrote ${DOC} in ${((Date.now() - start) / 1000).toFixed(1)} s`);
}

main();
