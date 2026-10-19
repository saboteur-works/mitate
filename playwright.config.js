'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 60000,
  workers: 1,
  reporter: 'list',
});
