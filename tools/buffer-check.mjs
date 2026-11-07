/**
 * Verify the transport never gets stuck showing a loading state, and that the
 * buffer band the bar draws is fed from real playback data.
 *
 * Reported symptom: the control "keeps spinning". The play key swaps its glyph
 * for a rotating disc whenever `loadingRecord` is true, and several early returns
 * in `play()` left that flag set forever — the transport read as permanently busy
 * while audio played normally.
 */
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const checks = [];
const check = (label, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ' + detail}`);
};

// --- a media element for the store ---------------------------------------
class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = 600;
    this.readyState = 4;
    this.paused = true;
    this.ended = false;
    this.src = '';
    this.volume = 1;
    this.muted = false;
    this.error = null;
    this.buffered = { length: 1, start: () => 0, end: () => 120 };
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name) { for (const fn of this.listeners.get(name) ?? []) fn(); }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  load() { this.emit('loadedmetadata'); }
  removeAttribute() {}
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
  useSyncExternalStore: (subscribe, read) => read(),
};
const registry = new Map();
globalThis.window = {
  __ModuleLoader__: { load: ({ id, factory }) => registry.set(id, factory) },
  location: { origin: 'http://127.0.0.1:1' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
// Every host call fails, so play() must still clear its loading flag.
globalThis.fetch = async () => new Response('{"ok":false,"code":"network"}', {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {}, prototype: {} };
globalThis.Blob = class { constructor() { this.size = 0; } };
new Function(source)();
const plugin = registry.get('dsh-plugin-vinyl-player')((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require(${name})`);
});
const store = plugin.__test_store;

// --- 1. a failed resolve must not leave the transport loading ------------
// Seed a record so play() reaches the resolve step, then fail it.
store.rows.set('BV1aaaaaaaaa', { bvid: 'BV1aaaaaaaaa', title: 'T', author: 'A', cover: '' });
await store.play('BV1aaaaaaaaa', 0, true);
await new Promise((resolve) => setTimeout(resolve, 60));
check('a failed resolve clears the loading flag', store.getSnapshot().loadingRecord === false, String(store.getSnapshot().loadingRecord));
check('a failed resolve reports an error', store.getSnapshot().status === 'error', store.getSnapshot().status);

// --- 2. the spinner is bound to that flag, so it stops -------------------
check('the play key spins while loading only', /loadingRecord\s*\n?\s*\?\s*h\(IconDisc[^)]*vr-spin/.test(source) || /snapshot\.loadingRecord[\s\S]{0,120}vr-spin/.test(source));

// --- 3. the buffer band is fed from the element --------------------------
const audio = new FakeAudio();
store.attach(audio);
const before = store.getSnapshot().buffered;
check('the store mirrors the buffered end', before === 120, String(before));
check('the buffered value is a number', typeof before === 'number');
check('the buffer never exceeds the duration', before <= store.getSnapshot().duration, `${before} <= ${store.getSnapshot().duration}`);

// After a sync with no buffered ranges, the band must collapse rather than throw.
audio.buffered = { length: 0, start: () => 0, end: () => 0 };
audio.emit('timeupdate');
check('an empty buffered list degrades safely', store.getSnapshot().buffered === 0, String(store.getSnapshot().buffered));

// --- 4. a throwing buffered getter cannot break the mirror --------------
const hostile = new FakeAudio();
Object.defineProperty(hostile, 'buffered', { get() { throw new Error('nope'); } });
let threw;
try {
  store.attach(hostile);
  hostile.emit('timeupdate');
} catch (error) {
  threw = error;
}
check('a throwing buffered getter is tolerated', threw === undefined, threw?.message);

// --- 5. the bar's CSS carries three layers ------------------------------
check('the track paints a buffered layer', /--vr-buffered/.test(source));
check('the buffered layer sits between played and unloaded', /var\(--vr-progress,0%\),[\s\S]{0,300}var\(--vr-buffered,0%\)/.test(source));
check('the buffered colour is grey, not the brand colour', /label-secondary[^)]*\) 45%/.test(source));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} buffer & loading checks passed`);
process.exit(failed === 0 ? 0 : 1);
