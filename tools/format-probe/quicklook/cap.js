const { app, nativeImage } = require('electron');
const fs = require('fs'), path = require('path');
const dir = process.argv.find(a => a.startsWith('--corpus=')).slice(9);
app.whenReady().then(async () => {
  for (const f of fs.readdirSync(dir)) for (const s of [512, 768, 1024, 1200, 1536, 2048]) {
    const t0 = performance.now();
    const im = await nativeImage.createThumbnailFromPath(path.join(dir, f), { width: s, height: s });
    const png = im.toPNG(); const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    console.log(f.padEnd(18), 'req', String(s).padEnd(5), 'png', w + 'x' + h, w === h ? 'SQUARE(icon?)' : 'content', Math.round(performance.now() - t0) + 'ms');
  }
  app.quit();
});
