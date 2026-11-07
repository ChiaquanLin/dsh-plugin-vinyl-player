/**
 * Prove a committed seek lands and stays.
 *
 * The report: the track jumps forward, then bounces back to where it started —
 * and the audio bounces with it. That is not the guard failing. It is the guard's
 * VERIFICATION failing: the previous build re-assigned `currentTime` while the
 * seek was still in flight, and assigning during a seek aborts it, so the
 * element fell back to the origin and the mirror followed.
 *
 * Two rules are pinned here:
 *
 *   1. a seek target is handed to the element ONCE. No poll loop re-assigns it.
 *   2. confirmation comes from the element's `seeked` event, and the requested
 *      position is held until then — a mid-seek position report must never
 *      release the guard, because the element can briefly report a value near the
 *      target before falling back.
 */
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const checks = [];
const check = (label, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ' + detail}`);
};

// --- a media element with abortable seeks ---------------------------------
class FakeAudio {
  constructor({ duration = 3600, readyState = 4 } = {}) {
    this.listeners = new Map();
    this._currentTime = 0;
    this.duration = duration;
    this.readyState = readyState;
    this.paused = true;
    this.ended = false;
    this.src = '';
    this.volume = 1;
    this.muted = false;
    this.error = null;
    /** Every assignment the element received, in order. */
    this.assignments = [];
    /** How many seeks were aborted by a re-assignment mid-flight. */
    this.aborted = 0;
    this.seeking = false;
  }
  set currentTime(value) {
    if (this.readyState < 1 || !Number.isFinite(this.duration)) return;
    if (this.seeking) {
      // This is what a real element does: a fresh assignment during a seek
      // cancels the in-flight one and returns to the origin.
      this.aborted += 1;
      this.seeking = false;
      this._currentTime = 0;
      this.assignments.push(value);
      this.emit('timeupdate');
      return;
    }
    this.assignments.push(value);
    // A real DASH element does NOT land synchronously: it keeps reporting the old
    // position while the fragment downloads, then jumps and fires `seeked`.
    // Landing is driven explicitly by land() so tests can model that window.
    this._target = value;
    if (this.landImmediately) this.land(value);
  }
  /** Complete the pending seek, as the browser does once the fragment arrives. */
  land(value = this._target) {
    this._currentTime = value;
    this.seeking = false;
    this.emit('timeupdate');
    this.emit('seeked');
  }
  get currentTime() { return this._currentTime; }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name) { for (const fn of this.listeners.get(name) ?? []) fn(); }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  load() {}
  removeAttribute() {}
  /** Simulate a slow DASH fragment: report an intermediate position without landing. */
  reportOnly(seconds) { this._currentTime = seconds; this.emit('timeupdate'); }
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
globalThis.fetch = async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
new Function(source)();
const plugin = registry.get('dsh-plugin-vinyl-player')((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require(${name})`);
});
const store = plugin.__test_store;
const SEEK_RETRY_MS = Number(source.match(/SEEK_RETRY_MS = (\d+)/)?.[1]);

// --- 1. a seek is assigned exactly once ----------------------------------
const audio = new FakeAudio();
store.attach(audio);
store.seek(1800, true);
check('one assignment is made', audio.assignments.length === 1, JSON.stringify(audio.assignments));
check('the element is asked for the target', audio._target === 1800, String(audio._target));
check('the seek was not aborted', audio.aborted === 0, `${audio.aborted} abort(s)`);

// No poll loop may re-assign it while the fragment downloads.
await new Promise((resolve) => setTimeout(resolve, SEEK_RETRY_MS * 4));
check('no follow-up assignment is issued', audio.assignments.length === 1, `${audio.assignments.length} total`);
check('the seek was not aborted by a poll', audio.aborted === 0, `${audio.aborted} abort(s)`);

// The fragment arrives: the element lands on the target.
audio.land();
check('the track lands on the target', audio.currentTime === 1800, String(audio.currentTime));
check('the bar follows it home', Math.abs(store.getSnapshot().time - 1800) < 1, String(store.getSnapshot().time));

// --- 2. a mid-seek report cannot release the guard -----------------------
// This is the bounce: the element says something near the target, then falls
// back to the origin. The bar must not follow it backwards.
const audio2 = new FakeAudio();
store.attach(audio2);
store.seek(1800, true);
check('the target is parked while in flight', store.seeking === 1800, String(store.seeking));
audio2.reportOnly(1799);   // a value near the target, but not landed
check('a near-target report does not release the guard', store.seekGuard !== undefined, JSON.stringify(store.seekGuard));
check('the bar still shows the requested position', store.getSnapshot().time === 1800, String(store.getSnapshot().time));

// The element falls back to the origin. The bar must NOT follow.
audio2.reportOnly(0);
check('a fallback report does not move the bar back', store.getSnapshot().time === 1800, String(store.getSnapshot().time));

// --- 3. `seeked` releases the guard once it lands -----------------------
audio2.land(1800);
check('a completed seek releases the guard', store.seekGuard === undefined, String(store.seekGuard));
audio2.reportOnly(1805);
check('after landing the bar tracks the element', store.getSnapshot().time === 1805, String(store.getSnapshot().time));

// --- 4. an unready element parks the request, then lands it once --------
const audio3 = new FakeAudio({ readyState: 0 });
store.attach(audio3);
store.seek(1200, true);
check('an unready element receives no assignment', audio3.assignments.length === 0, JSON.stringify(audio3.assignments));
audio3.readyState = 4;
audio3.emit('loadedmetadata');
await new Promise((resolve) => setTimeout(resolve, SEEK_RETRY_MS * 3));
check('the parked request is handed over when ready', audio3._target === 1200, String(audio3._target));
check('the retry assigned only once', audio3.assignments.length === 1, `${audio3.assignments.length}`);
audio3.land();
check('it lands once the element completes', audio3.currentTime === 1200, String(audio3.currentTime));

// --- 5. the guard expires rather than sticking forever -----------------
const audio4 = new FakeAudio();
store.attach(audio4);
store.seek(600, true);
check('a seek guard exists to expire', store.seekGuard !== undefined);
store.seekGuard.until = 0;
audio4.reportOnly(30);
check('an expired guard lets reports through', store.getSnapshot().time === 30, String(store.getSnapshot().time));

// --- 6. the source really confirms via the seeked event ----------------
check('the element listens for seeked', /audio\.addEventListener\('seeked', settle\)/.test(source));
check('the listener is removed on detach', /removeEventListener\('seeked', mirror\.settle\)/.test(source));
check('a handed-over seek is tracked separately', /this\.seeking = target/.test(source));
check(
  'a pending seek blocks position-based confirmation',
  /const pending = this\.seeking !== undefined/.test(source) && /const arrived = !pending &&/.test(source),
  'mid-seek reports cannot release the guard',
);

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} seek-landing checks passed`);
process.exit(failed === 0 ? 0 : 1);
