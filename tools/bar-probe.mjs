/**
 * Reproduce the SeekBar's event sequence against a real range input in a real
 * browser, and report which events actually arrive.
 *
 * The store's seek is proven to work in a real browser, so the defect must be in
 * how the bar reports the gesture. This page attaches the exact handler logic of
 * the shipped component to a real <input type=range> and dispatches the events a
 * user produces — a click on the track, and a drag — logging every callback and
 * its commit flag.
 */
import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const reports = [];
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>seekbar probe</title>
<style>
  body{background:#111;color:#eee;font:12px/1.6 monospace;padding:12px}
  pre{white-space:pre-wrap}.ok{color:#6ee7a8}.bad{color:#f87171}.warn{color:#fbbf24}
  #bar{width:300px;height:22px;display:block;margin:12px 0}
</style></head>
<body><pre id="log"></pre>
<input id="bar" type="range" min="0" max="21600" step="1" value="0">
<script>
const out = document.getElementById('log');
const lines = [];
function log(cls, msg) {
  lines.push('<span class="' + cls + '">' + msg + '</span>');
  out.innerHTML = lines.join('\\n');
  fetch('/report', { method: 'POST', body: msg });
}
window.onerror = (m, s, l) => log('bad', 'PAGE ERROR: ' + m + ' @' + l);

const bar = document.getElementById('bar');
const MAX = 21600;

// --- the shipped component's logic, verbatim in spirit ----------------------
let dragging = false;
let scrubRef = null;
const calls = [];

function preview(seconds) {
  scrubRef = seconds;
  calls.push({ seconds, commit: false });
  log('warn', '  preview(' + seconds + ')');
}
function commit(seconds) {
  scrubRef = null;
  calls.push({ seconds, commit: true });
  log('ok', '  COMMIT(' + seconds + ')');
}
function secondsAt(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return Math.round(ratio * MAX);
}
function endDrag(event, cancelled) {
  if (!dragging) { log('warn', '  endDrag ignored (not dragging)'); return; }
  dragging = false;
  if (event && event.currentTarget && event.currentTarget.hasPointerCapture && event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (cancelled) { scrubRef = null; log('warn', '  endDrag cancelled'); return; }
  const landed = event === undefined ? null : secondsAt(event);
  commit(landed !== null ? landed : (scrubRef !== null ? scrubRef : Math.round(Number(bar.value))));
}

// The events the component listens for, in the order the browser fires them.
for (const name of ['pointerdown','pointermove','pointerup','input','change','keyup','blur']) {
  bar.addEventListener(name, (event) => {
    log('warn', 'event ' + name + '  value=' + bar.value + ' dragging=' + dragging);
    if (name === 'pointerdown') { dragging = true; try { bar.setPointerCapture(event.pointerId); } catch (e) {} return; }
    if (name === 'pointermove') {
      if (!dragging) return;
      const rect = bar.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      preview(Math.round(ratio * MAX));
      return;
    }
    if (name === 'pointerup') { endDrag(event, false); return; }
    if (name === 'input' || name === 'change') {
      const next = Number(bar.value);
      if (dragging) preview(next); else commit(next);
      return;
    }
  });
}

// --- drive a real click on the track ---------------------------------------
(async () => {
  await new Promise((r) => setTimeout(r, 60));
  const rect = bar.getBoundingClientRect();
  log('ok', 'bar rect: left=' + rect.left.toFixed(0) + ' width=' + rect.width.toFixed(0));

  // 1) a real click at 25% of the track
  const clickX = rect.left + rect.width * 0.25;
  log('warn', '=== TEST 1: click at 25% (x=' + clickX.toFixed(0) + ') ===');
  bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: clickX, clientY: rect.top + rect.height / 2, pointerId: 1, bubbles: true, isPrimary: true, button: 0 }));
  // The browser updates value on click; emulate that then fire input.
  bar.value = String(Math.round(MAX * 0.25));
  bar.dispatchEvent(new Event('input', { bubbles: true }));
  bar.dispatchEvent(new PointerEvent('pointerup', { clientX: clickX, clientY: rect.top + rect.height / 2, pointerId: 1, bubbles: true, isPrimary: true, button: 0 }));
  await new Promise((r) => setTimeout(r, 60));

  const t1 = calls.filter((c) => c.commit).length;
  log(t1 > 0 ? 'ok' : 'bad', 'TEST 1 commits=' + t1 + '  ' + JSON.stringify(calls.slice(-3)));

  // 2) a real drag from 10% to 70%
  calls.length = 0;
  log('warn', '=== TEST 2: drag 10% -> 70% ===');
  const y = rect.top + rect.height / 2;
  const x0 = rect.left + rect.width * 0.10;
  const x1 = rect.left + rect.width * 0.70;
  bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y, pointerId: 2, bubbles: true, isPrimary: true, button: 0 }));
  for (let f = 0.1; f <= 0.7; f += 0.15) {
    const px = rect.left + rect.width * f;
    bar.value = String(Math.round(MAX * f));
    bar.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: y, pointerId: 2, bubbles: true, isPrimary: true }));
    bar.dispatchEvent(new Event('input', { bubbles: true }));
  }
  bar.value = String(Math.round(MAX * 0.7));
  bar.dispatchEvent(new PointerEvent('pointerup', { clientX: x1, clientY: y, pointerId: 2, bubbles: true, isPrimary: true, button: 0 }));
  await new Promise((r) => setTimeout(r, 60));

  const commits = calls.filter((c) => c.commit);
  log(commits.length === 1 ? 'ok' : 'bad', 'TEST 2 commits=' + commits.length + '  ' + JSON.stringify(commits));
  const expected = Math.round(MAX * 0.7);
  const got = commits[0] ? commits[0].seconds : -1;
  const accurate = Math.abs(got - expected) < MAX * 0.03;
  log(accurate ? 'ok' : 'bad', 'TEST 2 committed=' + got + ' expected≈' + expected + (accurate ? ' ACCURATE' : ' WRONG'));
  log('warn', 'PROBE-DONE');
})();
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/report') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { reports.push(body); console.log('[browser]', body); res.writeHead(204).end(); });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

await new Promise((resolve) => server.listen(8903, '127.0.0.1', resolve));
console.log('probe server: http://127.0.0.1:8903');

const profile = path.join(process.env.TEMP ?? '.', `vrbar-${Date.now()}`);
const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `--user-data-dir=${profile}`, '--virtual-time-budget=8000',
  '--dump-dom', 'http://127.0.0.1:8903/',
], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});
const exitCode = await new Promise((resolve) => child.on('exit', resolve));
await new Promise((r) => setTimeout(r, 300));
server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}

console.log('\n=== browser exit:', exitCode, '===');
const text = reports.join('\n');
const checks = [];
const check = (label, ok, detail) => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); };
check('a click on the track commits a position', /TEST 1 commits=[1-9]/.test(text), /TEST 1 commits=\d+/.exec(text)?.[0]);
check('a drag commits exactly once', /TEST 2 commits=1/.test(text), /TEST 2 commits=\d+/.exec(text)?.[0]);
check('the committed drag position is accurate', /ACCURATE/.test(text), /TEST 2 committed=(\d+)/.exec(text)?.[0]);

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} seekbar event checks passed`);
process.exit(failed === 0 ? 0 : 1);
