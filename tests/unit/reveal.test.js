import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createRevealer, defaultExists } = require('../../src/main/reveal.js');

function setup(existsResult) {
  const shell = { showItemInFolder: vi.fn() };
  const exists = vi.fn().mockResolvedValue(existsResult);
  return { shell, exists, revealer: createRevealer({ shell, exists }) };
}

describe('revealFile', () => {
  it('calls showItemInFolder exactly once with the exact path when the file exists', async () => {
    const { shell, revealer } = setup(true);
    await revealer.revealFile('/some/dir/file.txt');
    expect(shell.showItemInFolder).toHaveBeenCalledTimes(1);
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/some/dir/file.txt');
  });

  it('throws FILE_NOT_FOUND naming the path and does not call showItemInFolder when missing', async () => {
    const { shell, revealer } = setup(false);
    const p = '/some/dir/missing.txt';
    await expect(revealer.revealFile(p)).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
      message: expect.stringContaining(p),
    });
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('never reveals any path other than the one given (no parent fallback)', async () => {
    const missing = setup(false);
    await missing.revealer.revealFile('/some/dir/missing.txt').catch(() => {});
    expect(missing.shell.showItemInFolder).not.toHaveBeenCalled();

    const present = setup(true);
    await present.revealer.revealFile('/a/b.txt');
    for (const call of present.shell.showItemInFolder.mock.calls) {
      expect(call).toEqual(['/a/b.txt']);
    }
  });
});

describe('default exists', () => {
  it('is true for a real file and false after it is deleted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reveal-'));
    const file = path.join(dir, 'f.txt');
    fs.writeFileSync(file, 'x');
    try {
      expect(await defaultExists(file)).toBe(true);
      fs.unlinkSync(file);
      expect(await defaultExists(file)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is used by createRevealer when exists is not supplied', async () => {
    const shell = { showItemInFolder: vi.fn() };
    const revealer = createRevealer({ shell });
    const missing = path.join(os.tmpdir(), 'reveal-definitely-missing-xyz');
    await expect(revealer.revealFile(missing)).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });
});
