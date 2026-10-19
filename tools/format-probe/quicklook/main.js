const { app, nativeImage } = require('electron');
const fs = require('fs'), path = require('path');
const dir = process.argv.find(a => a.startsWith('--corpus=')).slice(9);
const out = process.argv.find(a => a.startsWith('--out=')).slice(6);
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(dir).sort()) {
    try { const im = await nativeImage.createThumbnailFromPath(path.join(dir, f), { width: 256, height: 256 });
      fs.writeFileSync(path.join(out, f + '.png'), im.toPNG()); } catch (e) { console.log('FAIL', f, e.message); }
  }
  app.quit();
});
