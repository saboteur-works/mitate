#!/usr/bin/env node
'use strict';
// Scan wall-time and peak-RSS measurement (FR-12, Task 34). Plain Node, no dependencies.
// Usage: node tools/scan-speed/measure.js [--runs 5] [--files 200000] [--skip-system] [--system-path /System/Library]
//
// Each measured run is a child process (`node measure.js --child <folder>`), wrapped in
// `/usr/bin/time -l` when that works, so the "maximum resident set size" it reports is the
// peak of the whole child process (including the worker thread). The child also samples
// process.memoryUsage.rss() every SAMPLE_MS and reports start RSS and sampled peak.
// The scan itself is runScanWithInfo() from src/main/discovery/run-scan.js (worker thread).
// Writes docs/measurements/scan-speed.md. Writes nothing inside the scanned system path.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { stats, sh, electronVersion, filesystemOf } = require('../lib/env.js');

const ROOT = path.resolve(__dirname, '..', '..');
const RESULT_FILE = path.join(ROOT, 'docs', 'measurements', 'scan-speed.md');
const SAMPLE_MS = 10;
const TIME_BIN = '/usr/bin/time';

// ---------------------------------------------------------------- child mode

async function childMain(folder) {
  const { runScanWithInfo } = require(path.join(ROOT, 'src', 'main', 'discovery', 'run-scan.js'));
  const startRss = process.memoryUsage.rss();
  let peak = startRss;
  const timer = setInterval(() => {
    const r = process.memoryUsage.rss();
    if (r > peak) peak = r;
  }, SAMPLE_MS);
  const skipped = [];
  const t0 = process.hrtime.bigint();
  try {
    const { records, threadId } = await runScanWithInfo(folder, {
      onError: (err, dir) => skipped.push({ code: err.code || 'unknown', dir }),
    });
    const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage.rss());
    const codes = {};
    for (const s of skipped) codes[s.code] = (codes[s.code] || 0) + 1;
    process.stdout.write(JSON.stringify({
      ok: true, files: records.length, threadId, wallMs, startRss, sampledPeakRss: peak,
      skippedDirectories: skipped.length, skippedByCode: codes,
    }));
  } catch (err) {
    clearInterval(timer);
    process.stdout.write(JSON.stringify({ ok: false, error: err.message, code: err.code || null }));
    process.exitCode = 1;
  }
}

// --------------------------------------------------------------- parent mode

function parseArgs(argv) {
  const opts = { runs: 5, files: 200000, skipSystem: false, systemPath: '/System/Library' };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--runs') opts.runs = Number(args[++i]);
    else if (a === '--files') opts.files = Number(args[++i]);
    else if (a === '--skip-system') opts.skipSystem = true;
    else if (a === '--system-path') opts.systemPath = args[++i];
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Error('--runs must be a positive integer');
  if (!Number.isInteger(opts.files) || opts.files < 1) throw new Error('--files must be a positive integer');
  return opts;
}

function machine() {
  const mem = sh('sysctl', ['-n', 'hw.memsize']);
  return {
    model: sh('sysctl', ['-n', 'hw.model']),
    cpu: sh('sysctl', ['-n', 'machdep.cpu.brand_string']),
    ram: /^\d+$/.test(mem) ? `${mem} bytes (${(Number(mem) / 2 ** 30).toFixed(0)} GiB)` : mem,
    os: sh('sw_vers', []).split('\n').join('; '),
    node: process.version,
    electron: electronVersion(),
  };
}

function timeBinaryWorks() {
  if (!fs.existsSync(TIME_BIN)) return { ok: false, detail: `${TIME_BIN} does not exist` };
  const r = spawnSync(TIME_BIN, ['-l', process.execPath, '-e', '0'], { encoding: 'utf8' });
  const m = /(\d+)\s+maximum resident set size/.exec(r.stderr || '');
  if (r.status === 0 && m) return { ok: true, detail: 'ok' };
  return { ok: false, detail: `exit ${r.status}; stderr: ${(r.stderr || '').trim().slice(0, 300)}` };
}

function oneRun(folder, useTime) {
  const childArgs = [__filename, '--child', folder];
  const r = useTime
    ? spawnSync(TIME_BIN, ['-l', process.execPath, ...childArgs], { encoding: 'utf8', maxBuffer: 64 * 2 ** 20 })
    : spawnSync(process.execPath, childArgs, { encoding: 'utf8', maxBuffer: 64 * 2 ** 20 });
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    return { ok: false, error: `unparseable child output; exit ${r.status}; stderr: ${(r.stderr || '').slice(0, 300)}` };
  }
  if (useTime) {
    const m = /(\d+)\s+maximum resident set size/.exec(r.stderr || '');
    data.timePeakRss = m ? Number(m[1]) : null;
  }
  return data;
}

function measureTree(label, folder, runs, useTime, extra) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    const r = oneRun(folder, useTime);
    results.push(r);
    console.log(`${label} run ${i + 1}/${runs}: ${r.ok ? `${r.files} files, ${r.wallMs.toFixed(1)} ms` : `FAILED ${r.error}`}`);
  }
  return { label, folder, results, extra };
}

// ----------------------------------------------------------------- rendering

const mb = (b) => (b / 2 ** 20).toFixed(1);
const ms = (v) => v.toFixed(1);

function renderMeasured(section, useTime) {
  const lines = [];
  const ok = section.results.filter((r) => r.ok);
  const bad = section.results.filter((r) => !r.ok);
  for (const e of section.extra) lines.push(`- ${e}`);
  lines.push(`- runs requested: ${section.results.length}; runs completed: ${ok.length}`);
  bad.forEach((r) => lines.push(`- failed run: ${r.error}`));
  if (!ok.length) return lines.join('\n');
  const peakOf = (r) => (useTime ? r.timePeakRss : r.sampledPeakRss);
  const peaks = ok.map(peakOf).filter((v) => v !== null && v !== undefined);
  lines.push(`- files found by discovery: ${[...new Set(ok.map((r) => r.files))].join(', ')} (per run, distinct values)`);
  lines.push(`- skipped directories (onError calls): ${ok.map((r) => r.skippedDirectories).join(', ')} (per run in order)`);
  const codes = ok[0].skippedByCode;
  lines.push(`- skipped directories by error code, run 1: ${Object.keys(codes).length ? JSON.stringify(codes) : 'none'}`);
  lines.push('');
  lines.push(`| run | files found | wall time ms | start RSS MiB | ${useTime ? 'peak RSS MiB (/usr/bin/time -l)' : 'peak RSS MiB (sampled)'} | sampled peak RSS MiB | skipped dirs |`);
  lines.push('|---|---|---|---|---|---|---|');
  section.results.forEach((r, i) => {
    if (!r.ok) {
      lines.push(`| ${i + 1} | failed | | | | | |`);
      return;
    }
    lines.push(`| ${i + 1} | ${r.files} | ${ms(r.wallMs)} | ${mb(r.startRss)} | ${peakOf(r) == null ? 'n/a' : mb(peakOf(r))} | ${mb(r.sampledPeakRss)} | ${r.skippedDirectories} |`);
  });
  const w = stats(ok.map((r) => r.wallMs));
  lines.push('');
  lines.push(`- wall time ms: min ${ms(w.min)}, median ${ms(w.median)}, max ${ms(w.max)}`);
  if (peaks.length) {
    const p = stats(peaks);
    lines.push(`- peak RSS MiB (${useTime ? '/usr/bin/time -l' : 'sampled'}): min ${mb(p.min)}, median ${mb(p.median)}, max ${mb(p.max)}`);
  }
  const sp = stats(ok.map((r) => r.sampledPeakRss));
  lines.push(`- sampled peak RSS MiB: min ${mb(sp.min)}, median ${mb(sp.median)}, max ${mb(sp.max)}`);
  return lines.join('\n');
}

function renderDoc(info) {
  const { opts, mach, timeCheck, useTime, a, b, fsInfo, tree, elapsedMs } = info;
  const out = [];
  out.push('# Scan wall time and peak RSS (FR-12)');
  out.push('');
  out.push(`Written by \`node tools/scan-speed/measure.js\` at ${new Date().toISOString()}. This file records only what was measured.`);
  out.push('');
  out.push('## Machine');
  out.push('');
  out.push(`- model (sysctl hw.model): ${mach.model}`);
  out.push(`- CPU (sysctl machdep.cpu.brand_string): ${mach.cpu}`);
  out.push(`- RAM (sysctl hw.memsize): ${mach.ram}`);
  out.push(`- OS (sw_vers): ${mach.os}`);
  out.push(`- Node version: ${mach.node}`);
  out.push(`- Electron version: ${mach.electron}`);
  out.push('- the script runs under plain Node, not inside Electron');
  out.push('');
  out.push('## Method');
  out.push('');
  out.push('- discovery runs in the worker thread through `runScanWithInfo` in `src/main/discovery/run-scan.js`; the record count is the length of the returned records');
  out.push('- wall time: `process.hrtime.bigint()` in the measuring child process from before the `runScanWithInfo` call until its promise resolved; it excludes child process start-up');
  out.push('- each run is a separate child process (`node tools/scan-speed/measure.js --child <folder>`), run one after another, in the order listed in the tables');
  out.push(`- /usr/bin/time -l check: ${timeCheck.ok ? 'worked' : `did not work (${timeCheck.detail})`}`);
  if (useTime) {
    out.push('- peak RSS: "maximum resident set size" reported by `/usr/bin/time -l` for the child process (whole process, includes Node start-up and the worker thread), converted from bytes to MiB');
  } else {
    out.push(`- peak RSS: largest value of \`process.memoryUsage.rss()\` sampled in the child every ${SAMPLE_MS} ms while the scan ran; a peak between two samples is not observed`);
  }
  out.push(`- start RSS: \`process.memoryUsage.rss()\` in the child before the scan call; "sampled peak RSS" is the largest \`process.memoryUsage.rss()\` value sampled every ${SAMPLE_MS} ms plus one read after the scan`);
  out.push(`- runs per tree: ${opts.runs} requested`);
  out.push('- cache state: not controlled; no cache purge was performed. The generated tree was written shortly before its runs. Run 1 of the /System/Library tree is the first scan of it by this script; whether those directories were already cached is not known');
  out.push('');
  out.push('## (a) Generated tree');
  out.push('');
  if (a) {
    out.push(`- location: under os.tmpdir() (\`${os.tmpdir()}\`), a fresh \`scan-speed-*\` directory, removed after the runs`);
    out.push(`- filesystem: df -P: ${fsInfo.df}`);
    out.push(`- filesystem: mount: ${fsInfo.mount}`);
    out.push(`- generator: \`tools/scan-speed/generate-tree.js\`, deterministic`);
    out.push(`- shape: depth ${tree.shape.depthBelowRoot} below the root, ${tree.shape.directoriesPerLevel.join(' x ')} directories per level (${tree.shape.leafDirectories} leaf directories), ${tree.stats.filesPerDir} files per leaf directory (the last leaf directories may hold fewer), all files 0 bytes`);
    out.push(`- extension mix, percent of files by index modulo 100: ${tree.shape.mix.map((m) => `${m.ext} ${m.percent}${m.supported ? '' : ' (unsupported)'}`).join(', ')}`);
    out.push(`- files generated: ${tree.stats.generated} (${tree.stats.supported} with a supported extension, ${tree.stats.unsupported} with an unsupported extension)`);
    out.push(`- generation time: ${ms(tree.genMs)} ms`);
    out.push(`- removal after the runs: ${tree.removed}`);
    out.push('');
    out.push(renderMeasured(a, useTime));
  } else {
    out.push(`not measured: ${opts.notMeasuredA}`);
  }
  out.push('');
  out.push('## (b) Real read-only tree');
  out.push('');
  if (b) {
    out.push(renderMeasured(b, useTime));
  } else {
    out.push(`not measured: ${opts.notMeasuredB}`);
  }
  out.push('');
  out.push(`## Elapsed`);
  out.push('');
  out.push(`- total script time: ${(elapsedMs / 1000).toFixed(1)} s`);
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------- main

function measureGenerated(opts, useTime) {
  const { generateTree, describeShape } = require('./generate-tree.js');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-speed-'));
  const tree = { shape: describeShape(), removed: 'not yet' };
  try {
    const t0 = Date.now();
    tree.stats = generateTree(base, opts.files);
    tree.genMs = Date.now() - t0;
    console.log(`generated ${tree.stats.generated} files in ${tree.genMs} ms under ${base}`);
    const fsInfo = filesystemOf(base);
    const sec = measureTree('generated', base, opts.runs, useTime, [
      `scanned path: ${base}`,
      `files generated: ${tree.stats.generated}`,
    ]);
    return { sec, tree, fsInfo, base };
  } finally {
    const t0 = Date.now();
    fs.rmSync(base, { recursive: true, force: true });
    tree.removed = fs.existsSync(base) ? 'directory still present' : `directory removed (${Date.now() - t0} ms)`;
  }
}

function main() {
  const started = Date.now();
  const opts = parseArgs(process.argv);
  const mach = machine();
  const timeCheck = timeBinaryWorks();
  const useTime = timeCheck.ok;
  console.log(`peak RSS method: ${useTime ? '/usr/bin/time -l' : `sampling (time check: ${timeCheck.detail})`}`);
  opts.notMeasuredA = '';
  opts.notMeasuredB = '';
  let a = null;
  let b = null;
  let tree = null;
  let fsInfo = null;
  try {
    const g = measureGenerated(opts, useTime);
    a = g.sec;
    tree = g.tree;
    fsInfo = g.fsInfo;
  } catch (err) {
    opts.notMeasuredA = `generated-tree measurement failed: ${err.message}`;
    console.error(opts.notMeasuredA);
  }
  if (opts.skipSystem) {
    opts.notMeasuredB = 'skipped by --skip-system';
  } else {
    b = measureTree('system', opts.systemPath, opts.runs, useTime, [
      `scanned path: ${opts.systemPath} (read-only; this script only scans it and writes nothing inside it)`,
    ]);
  }
  const doc = renderDoc({ opts, mach, timeCheck, useTime, a, b, fsInfo, tree, elapsedMs: Date.now() - started });
  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, doc);
  console.log(`wrote ${RESULT_FILE}`);
}

if (process.argv[2] === '--child') {
  childMain(process.argv[3]);
} else {
  main();
}
