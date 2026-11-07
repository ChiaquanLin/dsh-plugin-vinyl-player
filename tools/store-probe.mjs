/**
 * Drive the plugin's real store in a real browser and observe whether its seek
 * moves the audio element.
 *
 * The previous probe proved the raw chain works: a browser given this same
 * proxied stream seeks precisely and holds. So the defect is in how the plugin
 * requests the seek, not in the transport. This harness loads `lib/client.js`
 * itself with the real module loader, hands the store a real <audio> element
 * playing the real stream, asks for a seek, and reports what the element did.
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
const clientSource = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>store probe</title>
<style>body{background:#111;color:#eee;font:12px/1.5 monospace;padding:12px}pre{white-space:pre-wrap}
.ok{color:#6ee7a8}.bad{color:#f87171}.warn{color:#fbbf24}</style></head>
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

// The module loader facade the bundle expects.
const registry = new Map();
window.__ModuleLoader__ = { load: ({ id, factory }) => registry.set(id, factory) };
window.localStorage.clear();

// Minimal React good enough for the store path: the plugin's apply() runs, and
// the exported test hooks give direct access to the store.
const React = {
  createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c }),
  Fragment: 'F',
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f,
  useRef: (i) => ({ current: i }),
  useSyncExternalStore: (s, r) => r(),
};
</script>
<script src="/client.js"></script>
<script>
(async () => {
  try {
    const factory = registry.get('dsh-plugin-vinyl-player');
    if (!factory) { log('bad', 'bundle did not register'); return; }
    const plugin = factory((name) => {
      if (name === 'react') return React;
      throw new Error('unexpected require ' + name);
    });
    const store = plugin.__test_store;
    log('ok', 'plugin loaded; store hooks available');

    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.src = '/audio';
    document.body.appendChild(audio);
    store.attach(audio);
    log('ok', 'store attached to a real audio element');

    const waitFor = (name, ms = 15000) => new Promise((resolve) => {
      if (name === 'metadata' && audio.readyState >= 1) return resolve(true);
      const timer = setTimeout(() => resolve(false), ms);
      audio.addEventListener(name === 'metadata' ? 'loadedmetadata' : name, () => { clearTimeout(timer); resolve(true); }, { once: true });
    });

    const gotMeta = await waitFor('metadata');
    log(gotMeta ? 'ok' : 'bad', 'metadata: ' + gotMeta + ' dur=' + audio.duration + ' seekable=' + audio.seekable.length);
    if (!gotMeta) { log('bad', 'PROBE-DONE'); return; }

    // Pick a target well inside the track.
    const target = Math.max(5, Math.min(60, audio.duration * 0.3));
    log('warn', '--- store.seek(' + target.toFixed(1) + ', true) ---');
    store.seek(target, true);
    log('ok', 'store reported time=' + store.getSnapshot().time.toFixed(1) + ' guard=' + JSON.stringify(store.seekGuard));

    await new Promise((r) => setTimeout(r, 300));
    log('warn', '+300ms element.currentTime=' + audio.currentTime.toFixed(2) + ' seeking=' + audio.seeking);

    await new Promise((r) => setTimeout(r, 1500));
    const landed = Math.abs(audio.currentTime - target) < 2.5;
    log(landed ? 'ok' : 'bad', '+1800ms element.currentTime=' + audio.currentTime.toFixed(2) + (landed ? ' SEEK OK' : ' SEEK FAILED'));
    log('warn', 'store time=' + store.getSnapshot().time.toFixed(1) + ' seeking=' + JSON.stringify(store.seeking) + ' pending=' + JSON.stringify(store.pendingSeek));

    await new Promise((r) => setTimeout(r, 1500));
    const held = Math.abs(audio.currentTime - target) < 2.5;
    log(held ? 'ok' : 'bad', '+3300ms element.currentTime=' + audio.currentTime.toFixed(2) + (held ? ' HELD' : ' LOST'));

    // Also exercise the path the UI actually calls: preview then commit.
    log('warn', '--- UI path: preview then commit ---');
    store.seek(target * 0.5, false);
    await new Promise((r) => setTimeout(r, 60));
    store.seek(target * 0.5, true);
    await new Promise((r) => setTimeout(r, 2000));
    const uiOk = Math.abs(audio.currentTime - target * 0.5) < 2.5;
    log(uiOk ? 'ok' : 'bad', 'UI path landed at ' + audio.currentTime.toFixed(2) + (uiOk ? ' OK' : ' FAILED'));

    log('warn', 'PROBE-DONE');
  } catch (error) {
    log('bad', 'THROW: ' + (error && error.message ? error.message : String(error)));
    log('warn', 'PROBE-DONE');
  }
})();
</script>
</body></html>`;

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
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  if (url.pathname === '/client.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(clientSource);
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
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
});

const results = await source.search('周杰伦', 1);
const row = results[0];
const record = await source.resolve(row.bvid);
const stream = await source.audio(row.bvid, record.parts[0].cid);
const token = tokens.issue({ urls: stream.urls, referer: `https://www.bilibili.com/video/${row.bvid}/`, mime: stream.mime });
console.log('track:', record.title.slice(0, 36), '| dur:', record.parts[0].duration, 's');

const base = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
  if (req.url.startsWith('/audio')) req.url = `/vinyl-room/media?t=${token}`;
  base(req, res);
});

await new Promise((resolve) => server.listen(8901, '127.0.0.1', resolve));
console.log('probe server: http://127.0.0.1:8901');

const profile = path.join(process.env.TEMP ?? '.', `vrstore-${Date.now()}`);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${profile}`,
  '--virtual-time-budget=25000',
  '--dump-dom', 'http://127.0.0.1:8901/',
], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});
const exitCode = await new Promise((resolve) => child.on('exit', resolve));

await new Promise((resolve) => setTimeout(resolve, 300));
server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}

console.log('\n=== browser exit:', exitCode, '===');
const text = reports.join('\n');
const checks = [];
const check = (label, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
check('the bundle registered', /plugin loaded/.test(text));
check('the store attached to a real element', /store attached/.test(text));
check('metadata was available', /metadata: true/.test(text), /dur=([^\s]+)/.exec(text)?.[1]);
check('a seek was requested', /store\.seek/.test(text));
check('the element moved', /SEEK OK/.test(text), /element\.currentTime=([\d.]+)/.exec(text)?.[1]);
check('the position held', /HELD/.test(text));
check('the UI path also moves playback', /UI path landed.*OK/.test(text));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} store-probe checks passed`);
process.exit(failed === 0 ? 0 : 1);
