/**
 * Verify in a real browser that a Blob URL is seekable where a streamed route is
 * not, and that the swap preserves the playback position.
 *
 * The user's live diagnosis reported `seekable: [[0, 0]]` for a fully buffered
 * element served through the shell's `h-app://` bridge — an element that silently
 * ignores `currentTime` assignments. This confirms the remedy works on a real
 * engine: fetch the same bytes, hand them to the element as a Blob, and seek.
 */
import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bilibili, MediaTokens, handleRoute } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const source = new Bilibili();
const tokens = new MediaTokens();
const cache = new Map();
const reports = [];

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>blob seek</title>
<style>body{background:#111;color:#eee;font:12px/1.55 monospace;padding:12px}
pre{white-space:pre-wrap}.ok{color:#6ee7a8}.bad{color:#f87171}.warn{color:#fbbf24}</style></head>
<body><pre id="log"></pre>
<script>
const out = document.getElementById('log');
const lines = [];
function log(cls, msg) {
  lines.push('<span class="' + cls + '">' + msg + '</span>');
  out.innerHTML = lines.join('\\n');
  fetch('/report', { method: 'POST', body: msg });
}
window.onerror = (m) => log('bad', 'PAGE ERROR: ' + m);

const ranges = (el) => {
  const r = [];
  for (let i = 0; i < el.seekable.length; i++) r.push([+el.seekable.start(i).toFixed(1), +el.seekable.end(i).toFixed(1)]);
  return JSON.stringify(r);
};

(async () => {
  try {
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    document.body.appendChild(audio);

    const loaded = () => new Promise((resolve) => {
      if (audio.readyState >= 1) return resolve(true);
      audio.addEventListener('loadedmetadata', () => resolve(true), { once: true });
      setTimeout(() => resolve(false), 20000);
    });

    // --- 1. the streamed route ----------------------------------------
    audio.src = '/audio';
    audio.load();
    const ok1 = await loaded();
    log(ok1 ? 'ok' : 'bad', 'stream: rs=' + audio.readyState + ' dur=' + audio.duration + ' seekable=' + ranges(audio));
    log((audio.seekable.length > 0 && audio.seekable.end(0) > 0) ? 'ok' : 'warn',
        'STREAM seekable=' + ranges(audio));

    const streamTarget = Math.round(audio.duration * 0.5);
    const streamBefore = audio.currentTime;
    audio.currentTime = streamTarget;
    await new Promise((r) => setTimeout(r, 1500));
    log('warn', 'stream seek to ' + streamTarget + ': ' + streamBefore.toFixed(1) + ' -> ' + audio.currentTime.toFixed(1));

    // --- 2. the buffered Blob ------------------------------------------
    log('warn', '--- fetching the track into a Blob ---');
    const t0 = Date.now();
    const response = await fetch('/audio');
    const bytes = await response.arrayBuffer();
    log('ok', 'buffered ' + bytes.byteLength + ' bytes in ' + (Date.now() - t0) + 'ms');

    const blob = new Blob([bytes], { type: response.headers.get('content-type') || 'audio/mp4' });
    const url = URL.createObjectURL(blob);
    audio.src = url;
    audio.load();
    const ok2 = await loaded();
    log(ok2 ? 'ok' : 'bad', 'blob: rs=' + audio.readyState + ' dur=' + audio.duration + ' seekable=' + ranges(audio));

    const blobSeekable = audio.seekable.length > 0 && audio.seekable.end(0) > 0;
    log(blobSeekable ? 'ok' : 'bad', 'BLOB SEEKABLE=' + blobSeekable + ' range=' + ranges(audio));

    // --- 3. seek inside the Blob --------------------------------------
    const target = Math.round(audio.duration * 0.66);
    log('warn', 'blob seek to ' + target + 's');
    audio.currentTime = target;
    await new Promise((r) => setTimeout(r, 1800));
    const landed = Math.abs(audio.currentTime - target) < 2.5;
    log(landed ? 'ok' : 'bad', 'BLOB SEEK ' + (landed ? 'WORKED' : 'FAILED') + ' at ' + audio.currentTime.toFixed(1) + ' (target ' + target + ')');

    await new Promise((r) => setTimeout(r, 1200));
    const held = Math.abs(audio.currentTime - target) < 3;
    log(held ? 'ok' : 'bad', 'BLOB ' + (held ? 'HELD' : 'LOST') + ' at ' + audio.currentTime.toFixed(1));

    URL.revokeObjectURL(url);
    log('warn', 'PROBE-DONE');
  } catch (error) {
    log('bad', 'THROW: ' + (error && error.message ? error.message : String(error)));
    log('warn', 'PROBE-DONE');
  }
})();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/report') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const line = Buffer.concat(chunks).toString();
    reports.push(line);
    console.log('[browser]', line);
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
  if (url.pathname === '/css') {
    const m = /const STYLES = `([\s\S]*?)`;/.exec(fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8'));
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end(m ? m[1] : '');
    return;
  }
  const request = new Request(`http://127.0.0.1${req.url}`, {
    method: req.method,
    headers: req.headers.range ? { range: req.headers.range } : {},
  });
  const response = await handleRoute(request, source, tokens, cache);
  const headers = {};
  response.headers.forEach((value, name) => { headers[name] = value; });
  res.writeHead(response.status, headers);
  if (response.body === null) { res.end(); return; }
  const reader = response.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
  res.end();
});

const results = await source.search('周杰伦', 1);
const row = results[0];
const record = await source.resolve(row.bvid);
const stream = await source.audio(row.bvid, record.parts[0].cid);
const token = tokens.issue({ urls: stream.urls, referer: `https://www.bilibili.com/video/${row.bvid}/`, mime: stream.mime });
console.log('track:', record.title.slice(0, 34), '| dur:', record.parts[0].duration, 's');

const handler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
  if (req.url.startsWith('/audio')) req.url = `/vinyl-room/media?t=${token}`;
  handler(req, res);
});

await new Promise((resolve) => server.listen(8911, '127.0.0.1', resolve));
const profile = path.join(process.env.TEMP ?? '.', `vrblob-${Date.now()}`);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${profile}`, '--virtual-time-budget=45000',
  '--dump-dom', 'http://127.0.0.1:8911/',
], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});
const exitCode = await new Promise((resolve) => child.on('exit', resolve));
await new Promise((r) => setTimeout(r, 400));
server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}

console.log('\n=== browser exit:', exitCode, '===');
const text = reports.join('\n');
const checks = [];
const check = (label, ok, detail) => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); };
check('the track buffered into memory', /buffered \d+ bytes/.test(text), /\d+ bytes in \d+ms/.exec(text)?.[0]);
check('the Blob source is seekable', /BLOB SEEKABLE=true/.test(text), /BLOB SEEKABLE=\w+/.exec(text)?.[0]);
check('a seek inside the Blob works', /BLOB SEEK WORKED/.test(text), /BLOB SEEK \w+ at ([\d.]+)/.exec(text)?.[0]);
check('the position holds', /BLOB HELD/.test(text));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} blob-seek checks passed`);
process.exit(failed === 0 ? 0 : 1);
