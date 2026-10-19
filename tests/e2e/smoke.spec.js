'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect, _electron: electron } = require('@playwright/test');

test('app launches and opens a window with a title', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-organizer-e2e-'));
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: path.join(__dirname, '..', '..'),
  });
  try {
    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    const title = await window.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title).toBe('Media Organizer');
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
