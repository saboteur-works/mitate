'use strict';

// The entry point e2e tests pass to electron.launch: the real app, run in the
// background (see background-main.js).
const path = require('node:path');

module.exports = { APP_ENTRY: path.join(__dirname, 'background-main.js') };
