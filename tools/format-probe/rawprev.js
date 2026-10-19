// Naive embedded-JPEG extractor: walk JPEG markers from each SOI, keep the largest complete image.
const fs = require('fs'), path = require('path');
function jpegEnd(b, s) {
  let i = s + 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xFF) return -1;
    const m = b[i + 1];
    if (m === 0xD9) return i + 2;
    if (m === 0xDA) { // scan entropy-coded data
      i += 2 + b.readUInt16BE(i + 2);
      while (i + 1 < b.length) {
        if (b[i] === 0xFF && b[i + 1] !== 0 && !(b[i + 1] >= 0xD0 && b[i + 1] <= 0xD7)) break;
        i++;
      }
      continue;
    }
    if (m >= 0xD0 && m <= 0xD7 || m === 0x01) { i += 2; continue; }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return -1;
}
for (const f of process.argv.slice(3)) {
  const t0 = process.hrtime.bigint();
  const b = fs.readFileSync(f); let best = null; let n = 0;
  for (let s = b.indexOf(Buffer.from([0xFF, 0xD8, 0xFF])); s !== -1; s = b.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]), s + 2)) {
    const e = jpegEnd(b, s); if (e > 0) { n++; if (!best || e - s > best[1] - best[0]) best = [s, e]; }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (!best) { console.log(path.basename(f), 'no JPEG found', ms.toFixed(0) + 'ms'); continue; }
  const out = path.join(process.argv[2], 'x_' + path.basename(f) + '.jpg');
  fs.writeFileSync(out, b.subarray(best[0], best[1]));
  console.log(path.basename(f).padEnd(14), 'candidates', n, 'largest', ((best[1] - best[0]) / 1e6).toFixed(2) + 'MB', 'read+scan', ms.toFixed(0) + 'ms', '->', path.basename(out));
}
