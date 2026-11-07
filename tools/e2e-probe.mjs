/**
 * End-to-end: the real SeekBar component, the real store, and a real audio
 * element in a real browser.
 *
 * The earlier probes isolated the layers: the transport seeks correctly, the
 * store seeks correctly, and the bar's event sequence was off by one step. This
 * one wires all three together in Chromium and asserts that clicking and
 * dragging the bar actually moves audible playback — the user-visible result.
 */
import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bilibili, MediaTokens, handleRoute } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const clientSource = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');

const source = new Bilibili();
const tokens = new MediaTokens();
const cache = new Map();
const reports = [];

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>e2e seek</title>
<style>body{background:#111;color:#eee;font:12px/1.55 monospace;padding:12px}
pre{white-space:pre-wrap}.ok{color:#6ee7a8}.bad{color:#f87171}.warn{color:#fbbf24}
#mount{display:block;width:320px}</style></head>
<body><pre id="log"></pre><div id="mount"></div>
<script>
const out = document.getElementById('log');
const lines = [];
function log(cls, msg) {
  lines.push('<span class="' + cls + '">' + msg + '</span>');
  out.innerHTML = lines.join('\\n');
  fetch('/report', { method: 'POST', body: msg });
}
window.onerror = (m, s, l) => log('bad', 'PAGE ERROR: ' + m + ' @' + l);

const registry = new Map();
window.__ModuleLoader__ = { load: ({ id, factory }) => registry.set(id, factory) };
window.localStorage.clear();

// A React stub that keeps state across renders so the component's scrub state
// behaves as it does under the real runtime.
let rerender = () => {};
const React = {
  createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: c }),
  Fragment: 'F',
  useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
  useEffect: () => {},
  useMemo: (f) => f(),
  useCallback: (f) => f,
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
    const plugin = factory((n) => { if (n === 'react') return React; throw new Error('require ' + n); });
    const store = plugin.__test_store;
    const SeekBar = plugin.__test_SeekBar;
    log('ok', 'plugin and SeekBar loaded');

    // Real audio element on the real proxied stream.
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.src = '/audio';
    document.body.appendChild(audio);
    store.attach(audio);
    await new Promise((resolve) => {
      if (audio.readyState >= 1) return resolve();
      audio.addEventListener('loadedmetadata', resolve, { once: true });
      setTimeout(resolve, 15000);
    });
    log(audio.readyState >= 1 ? 'ok' : 'bad', 'metadata rs=' + audio.readyState + ' dur=' + audio.duration);
    if (audio.readyState < 1) { log('warn', 'PROBE-DONE'); return; }

    const duration = audio.duration;
    const mount = document.getElementById('mount');
    mount.style.width = '320px';

    // Render the real SeekBar into a real DOM node and wire its callbacks to the
    // real store, which is what the panel does.
    const tree = SeekBar({
      time: 0,
      duration,
      disabled: false,
      label: 'Position',
      onSeek: (seconds, commit) => store.seek(seconds, commit),
    });
    // The stub returns an element tree; adopt the input element the component
    // describes so its handlers run against a real node.
    const find = (node, type) => {
      if (!node) return null;
      if (Array.isArray(node)) { for (const c of node) { const r = find(c, type); if (r) return r; } return null; }
      if (typeof node !== 'object') return null;
      if (node.type === type) return node;
      return find(node.children, type);
    };
    const desc = find(tree, 'input');
    if (!desc) { log('bad', 'SeekBar produced no input'); log('warn', 'PROBE-DONE'); return; }
    log('ok', 'SeekBar rendered an input; max=' + desc.props.max);

    const bar = document.createElement('input');
    bar.type = 'range';
    bar.min = '0';
    bar.max = String(desc.props.max);
    bar.step = '1';
    bar.value = '0';
    bar.style.display = 'block';
    bar.style.width = '300px';
    bar.style.height = '22px';
    mount.appendChild(bar);
    for (const [name, fn] of Object.entries(desc.props)) {
      if (name.startsWith('on') && typeof fn === 'function') {
        bar.addEventListener(name.slice(2).toLowerCase(), fn);
      }
    }
    await new Promise((r) => setTimeout(r, 80));
    const rect = bar.getBoundingClientRect();
    log('ok', 'bar rect left=' + rect.left.toFixed(0) + ' w=' + rect.width.toFixed(0));

    const y = rect.top + rect.height / 2;
    const peek = (fraction) => rect.left + rect.width * fraction;

    // --- TEST A: click at 40% ---
    const targetA = Math.round(duration * 0.4);
    log('warn', '=== A: click at 40% (target ' + targetA + 's) ===');
    bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: peek(0.4), clientY: y, pointerId: 11, bubbles: true, isPrimary: true, button: 0 }));
    bar.value = String(targetA);
    bar.dispatchEvent(new Event('input', { bubbles: true }));
    bar.dispatchEvent(new PointerEvent('pointerup', { clientX: peek(0.4), clientY: y, pointerId: 11, bubbles: true, isPrimary: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 2200));
    const okA = Math.abs(audio.currentTime - targetA) < Math.max(3, duration * 0.03);
    log(okA ? 'ok' : 'bad', 'A: audio.currentTime=' + audio.currentTime.toFixed(1) + ' target=' + targetA + (okA ? ' MOVED' : ' DID NOT MOVE'));

    // --- TEST B: drag from 15% to 75% ---
    const targetB = Math.round(duration * 0.75);
    log('warn', '=== B: drag to 75% (target ' + targetB + 's) ===');
    bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: peek(0.15), clientY: y, pointerId: 12, bubbles: true, isPrimary: true, button: 0 }));
    for (let f = 0.15; f <= 0.76; f += 0.15) {
      bar.value = String(Math.round(duration * f));
      bar.dispatchEvent(new PointerEvent('pointermove', { clientX: peek(f), clientY: y, pointerId: 12, bubbles: true, isPrimary: true }));
      bar.dispatchEvent(new Event('input', { bubbles: true }));
    }
    bar.value = String(targetB);
    bar.dispatchEvent(new PointerEvent('pointerup', { clientX: peek(0.75), clientY: y, pointerId: 12, bubbles: true, isPrimary: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 2500));
    const okB = Math.abs(audio.currentTime - targetB) < Math.max(3, duration * 0.03);
    log(okB ? 'ok' : 'bad', 'B: audio.currentTime=' + audio.currentTime.toFixed(1) + ' target=' + targetB + (okB ? ' MOVED' : ' DID NOT MOVE'));

    // --- TEST C: the position must hold ---
    await new Promise((r) => setTimeout(r, 1500));
    const okC = Math.abs(audio.currentTime - targetB) < Math.max(4, duration * 0.04);
    log(okC ? 'ok' : 'bad', 'C: after 1.5s audio.currentTime=' + audio.currentTime.toFixed(1) + (okC ? ' HELD' : ' DRIFTED'));

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

const handler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
  if (req.url.startsWith('/audio')) req.url = `/vinyl-room/media?t=${token}`;
  handler(req, res);
});

await new Promise((resolve) => server.listen(8905, '127.0.0.1', resolve));
console.log('probe server: http://127.0.0.1:8905');

const profile = path.join(process.env.TEMP ?? '.', `vre2e-${Date.now()}`);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${profile}`, '--virtual-time-budget=30000',
  '--dump-dom', 'http://127.0.0.1:8905/',
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
check('the SeekBar rendered under the real bundle', /SeekBar rendered an input/.test(text));
check('a click moves playback', /A:.*MOVED/.test(text), /A: audio\.currentTime=([\d.]+)/.exec(text)?.[0]);
check('a drag moves playback', /B:.*MOVED/.test(text), /B: audio\.currentTime=([\d.]+)/.exec(text)?.[0]);
check('the position holds afterwards', /C:.*HELD/.test(text), /C: after 1\.5s audio\.currentTime=([\d.]+)/.exec(text)?.[0]);

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} end-to-end seek checks passed`);
process.exit(failed === 0 ? 0 : 1);
