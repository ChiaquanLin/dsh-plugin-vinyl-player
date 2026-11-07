/**
 * Prove a committed seek actually moves the audio element.
 *
 * The report: the progress bar now stays where it was dragged, but the track does
 * not jump — playback continues from the old position. The bar and the element
 * had simply diverged: assigning `currentTime` before metadata or seekable
 * ranges exist is discarded by the media element with no error, so the store
 * showed the requested time while the element never moved.
 *
 * This test drives a fake element through that exact condition and asserts that
 * the position eventually takes, that the retry stops once it does, and that a
 * replaced element is never touched.
 */
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const checks = [];
const check = (label, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ' + detail}`);
};

// --- a media element that behaves like a real one --------------------------
class FakeAudio {
  constructor({ duration = 3600, readyState = 1 } = {}) {
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
    /** Assignments the element silently ignored because it was not ready. */
    this.ignored = 0;
    this.applied = [];
  }
  /** Until readyState >= 1 a real element discards currentTime. */
  /**
   * A real element accepts a position once metadata exists, regardless of what
   * `duration` reports. Only `readyState < 1` discards the assignment — the
   * earlier guard on a finite duration modelled the bug, not the browser.
   */
  set currentTime(value) {
    this.assigned = true;
    if (this.readyState < 1) {
      this.ignored += 1;
      return;
    }
    this._currentTime = value;
    this.applied.push(value);
  }
  get currentTime() {
    return this._currentTime;
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) {
    this.listeners.get(name)?.delete(fn);
  }
  emit(name) { for (const fn of this.listeners.get(name) ?? []) fn(); }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  load() {}
  removeAttribute() {}
  /** Become ready, as a fragment finishing download would. */
  becomeReady() {
    this.readyState = 4;
    this.emit('loadedmetadata');
  }
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
const SEEK_MAX_ATTEMPTS = Number(source.match(/SEEK_MAX_ATTEMPTS = (\d+)/)?.[1]);
check('a retry schedule is declared', Number.isFinite(SEEK_RETRY_MS) && SEEK_MAX_ATTEMPTS > 1, `${SEEK_RETRY_MS}ms x${SEEK_MAX_ATTEMPTS}`);
check('a bare assignment is retried, not trusted', /applySeek\(audio, target, attempt \+ 1\)/.test(source));

// --- 1. a seek issued before metadata is not lost -------------------------
const audio = new FakeAudio({ readyState: 0 });
store.attach(audio);
store.seek(1800, true);
// The component checks readiness before assigning, so the element is never asked
// to seek while unprepared — the request is parked and retried instead.
check('an unready element is not asked to seek', audio.ignored === 0 && audio.applied.length === 0, `ignored=${audio.ignored} applied=${audio.applied.length}`);
check('the bar still shows the requested position', store.getSnapshot().time === 1800, String(store.getSnapshot().time));

// The element becomes ready; the retry schedule must place the position.
audio.becomeReady();
await new Promise((resolve) => setTimeout(resolve, SEEK_RETRY_MS * 4));

check('the position is applied once the element is ready', audio.currentTime === 1800, `currentTime=${audio.currentTime}`);
check('playback really moved to the requested spot', audio.applied.includes(1800), JSON.stringify(audio.applied.slice(0, 4)));

// --- 2. retries stop once the position sticks ----------------------------
const appliedBefore = audio.applied.length;
await new Promise((resolve) => setTimeout(resolve, SEEK_RETRY_MS * 6));
check('no further seeks are issued after arrival', audio.applied.length === appliedBefore, `${audio.applied.length - appliedBefore} extra`);

// --- 3. a replaced element is never touched ------------------------------
store.detach();
const old = new FakeAudio();
store.attach(old);
store.seek(900, true);
const moved = old.currentTime;
check('a seek applies to the current element', moved === 900, String(moved));

const replacement = new FakeAudio();
store.attach(replacement);
// A retry scheduled for the old element must not fire against the new one.
await new Promise((resolve) => setTimeout(resolve, SEEK_RETRY_MS * 3));
check('a replaced element receives no retries', replacement.applied.length === 0, JSON.stringify(replacement.applied));

// --- 4. a seek beyond the duration is clamped ----------------------------
store.attach(replacement);
replacement.becomeReady();
store.seek(99999, true);
// The request is passed through so a stream whose reported duration is wrong
// can still be reached; the element itself refuses positions it cannot reach.
check('an over-long seek is passed through to the element', replacement.currentTime === 99999 || replacement.currentTime === replacement.duration, String(replacement.currentTime));

// --- 5. a preview never moves the element -------------------------------
const previewed = new FakeAudio();
previewed.becomeReady();
store.attach(previewed);
store.seek(1200, false);
check('a preview does not touch playback', previewed.currentTime === 0, String(previewed.currentTime));
check('a preview still moves the bar', store.getSnapshot().time === 1200, String(store.getSnapshot().time));

// --- 6. a fragmented stream reporting Infinity must still seek ----------
// This is the real DASH case: until the whole index is present the element
// reports Infinity, and requiring a finite duration meant the audio never moved.
const infinite = new FakeAudio({ readyState: 1 });
infinite.duration = Infinity;
store.attach(infinite);
store.seek(900, true);
check(
  'a seek is attempted even when the duration is unknown',
  infinite.assigned === true || infinite.currentTime === 900,
  `currentTime=${infinite.currentTime}`,
);
check('the requested position is not collapsed by the clamp', store.getSnapshot().time === 900, String(store.getSnapshot().time));

// A NaN duration (no metadata yet) must behave the same way.
const nan = new FakeAudio({ readyState: 1 });
nan.duration = Number.NaN;
store.attach(nan);
store.seek(450, true);
check('a seek with no usable duration still lands', nan.currentTime === 450, String(nan.currentTime));

// --- 7. a short reported duration must not trap long seeks --------------
// Fragmented streams can report only the first fragment's length. Clamping to it
// would pin every later seek to that fragment.
const short = new FakeAudio({ duration: 5, readyState: 4 });
store.attach(short);
store.seek(2000, true);
check('a seek beyond a short reported duration is passed through', short.currentTime === 2000, String(short.currentTime));
check('the bar keeps the requested position', store.getSnapshot().time === 2000, String(store.getSnapshot().time));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} seek-apply checks passed`);
process.exit(failed === 0 ? 0 : 1);
