const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path');
const dir = process.argv.find(a => a.startsWith('--corpus=')).slice(9);
const out = process.argv.find(a => a.startsWith('--out=')).slice(6);
app.whenReady().then(() => {
  const w = new BrowserWindow({ show: false, width: 800, height: 600,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  ipcMain.on('done', (_e, r) => { fs.writeFileSync(out, JSON.stringify(r, null, 1)); app.quit(); });
  w.loadFile('index.html', { query: { dir } });
  setTimeout(() => { console.error('TIMEOUT'); app.exit(2); }, 600000);
});
