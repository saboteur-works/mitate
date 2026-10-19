const sharp = require('sharp'), fs = require('fs'), path = require('path');
const dir = process.argv[2];
console.log('sharp', sharp.versions);
console.log('heif:', JSON.stringify(sharp.format.heif), '\njxl:', JSON.stringify(sharp.format.jxl||null), '\nmagick:', JSON.stringify(sharp.format.magick||null));
(async () => {
  for (const f of fs.readdirSync(dir).sort().filter(f => /^[ir]_/.test(f))) {
    const t0 = Date.now();
    try { const m = await sharp(path.join(dir, f)).resize(512).jpeg().toBuffer({ resolveWithObject: true }); console.log('OK  ', f.padEnd(20), m.info.width + 'x' + m.info.height, (Date.now() - t0) + 'ms'); }
    catch (e) { console.log('FAIL', f.padEnd(20), e.message.split('\n')[0].slice(0, 90)); }
  }
})();
