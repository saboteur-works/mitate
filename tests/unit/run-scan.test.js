import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const require = createRequire(import.meta.url);
const { Worker, threadId: mainThreadId } = require('node:worker_threads');
const { buildFixtureTree, cleanupFixtureTree } = require('../support/fixture-tree.js');
const { discoverSync } = require('../../src/main/discovery/discover.js');
const { runScan, runScanWithInfo } = require('../../src/main/discovery/run-scan.js');

const WORKER_FILE = path.resolve(import.meta.dirname, '../../src/main/discovery/worker.js');

let fixture;

beforeAll(() => {
  fixture = buildFixtureTree();
});

afterAll(() => {
  if (fixture) cleanupFixtureTree(fixture.root);
});

describe('runScan', () => {
  it('runs in a separate thread', async () => {
    const { threadId } = await runScanWithInfo(fixture.root);
    expect(threadId).toBeGreaterThan(0);
    expect(threadId).not.toBe(mainThreadId);
  });

  it('isMainThread is false inside the worker', async () => {
    const worker = new Worker(WORKER_FILE, { workerData: { folderPath: fixture.root } });
    const done = await new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', (m) => m.type === 'done' && resolve(m));
    });
    await worker.terminate();
    expect(done.isMainThread).toBe(false);
  });

  it('result deep-equals discoverSync on the fixture tree', async () => {
    const records = await runScan(fixture.root);
    expect(records.length).toBeGreaterThan(0);
    expect(records).toEqual(discoverSync(fixture.root));
  });

  it('works regardless of cwd', async () => {
    const prev = process.cwd();
    process.chdir(os.tmpdir());
    try {
      expect(await runScan(fixture.root)).toEqual(discoverSync(fixture.root));
    } finally {
      process.chdir(prev);
    }
  });

  it('rejects descriptively for a missing root', async () => {
    const missing = path.join(os.tmpdir(), `no-such-dir-${process.pid}-${Date.now()}`);
    await expect(runScan(missing)).rejects.toThrow(/Cannot scan folder.*no-such-dir/);
    await expect(runScan(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects for a non-absolute path', async () => {
    await expect(runScan('relative/path')).rejects.toThrow(/absolute/);
  });

  it('passes unreadable-subdirectory warnings to onError', async () => {
    if (process.getuid && process.getuid() === 0) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-scan-warn-'));
    try {
      fs.mkdirSync(path.join(dir, 'locked'));
      fs.writeFileSync(path.join(dir, 'locked', 'a.jpg'), 'x');
      fs.writeFileSync(path.join(dir, 'b.jpg'), 'x');
      fs.chmodSync(path.join(dir, 'locked'), 0o000);
      const warnings = [];
      const records = await runScan(dir, { onError: (err, p) => warnings.push([err.code, p]) });
      expect(records.map((r) => r.relativePath)).toEqual(['b.jpg']);
      expect(warnings).toEqual([['EACCES', path.join(dir, 'locked')]]);
    } finally {
      fs.chmodSync(path.join(dir, 'locked'), 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runScan on a large tree', () => {
  const DIRS_A = 20;
  const DIRS_B = 30;
  const PER_DIR = 100;
  const FILES = DIRS_A * DIRS_B * PER_DIR;
  let big;

  beforeAll(() => {
    big = fs.mkdtempSync(path.join(os.tmpdir(), 'run-scan-big-'));
    for (let a = 0; a < DIRS_A; a++) {
      for (let b = 0; b < DIRS_B; b++) {
        const dir = path.join(big, `a${a}`, `b${b}`, 'c');
        fs.mkdirSync(dir, { recursive: true });
        for (let f = 0; f < PER_DIR; f++) fs.writeFileSync(path.join(dir, `f${f}.jpg`), '');
      }
    }
  }, 120000);

  afterAll(() => {
    if (big) fs.rmSync(big, { recursive: true, force: true });
  }, 120000);

  it('keeps the main event loop servicing timers during a scan', async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 5);
    const start = performance.now();
    let records;
    try {
      records = await runScan(big);
    } finally {
      clearInterval(timer);
    }
    const ms = Math.round(performance.now() - start);
    console.log(`large scan: ${records.length} files, ${ms} ms, ${ticks} timer ticks (5 ms interval)`);
    expect(records).toHaveLength(FILES);
    expect(ticks).toBeGreaterThanOrEqual(3);
  }, 120000);
});
