'use strict';

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { newUserDataDir, launchApp } = require('../support/e2e-app.js');

test('app launches and opens a window with a title', async () => {
  const userDataDir = newUserDataDir('e2e');
  const { app, window } = await launchApp(userDataDir);
  try {
    const title = await window.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title).toBe('Media Organizer');
  } finally {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
