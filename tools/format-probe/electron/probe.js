const { ipcRenderer } = require('electron');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const dir = new URLSearchParams(location.search).get('dir');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = f => pathToFileURL(path.join(dir, f)).href;

async function makeWebp() {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#3c3'; g.fillRect(40, 40, 100, 100);
  const b = await new Promise(r => c.toBlob(r, 'image/webp', 0.9));
  fs.writeFileSync(path.join(dir, 'i_webp.webp'), Buffer.from(await b.arrayBuffer()));
}
function nonBlank(src, w, h) {
  const c = document.createElement('canvas'); c.width = Math.min(w, 64); c.height = Math.min(h, 64);
  const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
  return s > 0;
}
function testImage(f) {
  return new Promise(res => {
    const im = new Image(); const t0 = performance.now();
    const to = setTimeout(() => res({ ok: false, err: 'timeout' }), 20000);
    im.onload = () => { clearTimeout(to); res({ ok: im.naturalWidth > 0, w: im.naturalWidth, h: im.naturalHeight, painted: nonBlank(im, im.naturalWidth, im.naturalHeight), ms: Math.round(performance.now() - t0) }); };
    im.onerror = () => { clearTimeout(to); res({ ok: false, err: 'onerror', ms: Math.round(performance.now() - t0) }); };
    im.src = url(f);
  });
}
async function testAV(f, kind) {
  const el = document.createElement(kind); el.muted = true; el.preload = 'auto';
  document.body.appendChild(el);
  const r = await new Promise(res => {
    let done = false; const fin = x => { if (!done) { done = true; res(x); } };
    el.onerror = () => fin({ ok: false, err: 'error code ' + (el.error && el.error.code) + ' ' + (el.error && el.error.message || '') });
    el.onloadeddata = async () => {
      try { await el.play(); } catch (e) { return fin({ ok: false, err: 'play: ' + e.message }); }
      await sleep(1200); el.pause();
      fin({ ok: true });
    };
    el.src = url(f);
    setTimeout(() => fin({ ok: false, err: 'timeout readyState=' + el.readyState }), 15000);
  });
  r.t = +el.currentTime.toFixed(2); r.dur = +(el.duration || 0).toFixed(2);
  r.audioBytes = el.webkitAudioDecodedByteCount || 0;
  if (kind === 'video') {
    r.w = el.videoWidth; r.h = el.videoHeight; r.videoBytes = el.webkitVideoDecodedByteCount || 0;
    r.frames = el.getVideoPlaybackQuality().totalVideoFrames;
    r.painted = el.videoWidth > 0 ? nonBlank(el, el.videoWidth, el.videoHeight) : false;
  }
  el.remove(); return r;
}
const mimes = ['video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"', 'video/mp4; codecs="av01.0.05M.08"',
  'video/webm; codecs="vp9"', 'video/webm; codecs="vp8"', 'video/quicktime', 'video/x-matroska', 'video/mp4; codecs="ap4h"', 'video/mp4; codecs="apcn"',
  'audio/mpeg', 'audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="alac"', 'audio/flac', 'audio/wav', 'audio/aiff', 'audio/x-aiff', 'audio/ogg; codecs="opus"', 'audio/ogg; codecs="vorbis"',
  'audio/mp4; codecs="ac-3"', 'audio/mp4; codecs="ec-3"', 'audio/x-ms-wma', 'image/jxl'];
(async () => {
  await makeWebp();
  const files = fs.readdirSync(dir).sort();
  const results = { versions: process.versions, canPlayType: {}, files: {} };
  const v = document.createElement('video');
  for (const m of mimes) results.canPlayType[m] = v.canPlayType(m) || '""';
  for (const f of files) {
    const p = f.split('_')[0];
    let r;
    if (p === 'i' || p === 'r' || f.endsWith('.svg') || p === 'x') r = await testImage(f);
    else if (p === 'v') r = await testAV(f, 'video');
    else if (p === 'a') r = await testAV(f, 'audio');
    else continue;
    results.files[f] = r;
  }
  ipcRenderer.send('done', results);
})();
