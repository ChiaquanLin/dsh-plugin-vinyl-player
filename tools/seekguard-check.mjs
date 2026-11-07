/**
 * Prove a committed seek survives the audio element's stale clock.
 *
 * The user's report: drag the progress bar forward, release it, and the bar
 * snaps back to where the drag started. The cause is not the slider — it is the
 * mirror. On a DASH stream, after `currentTime` is assigned the element keeps
 * firing `timeupdate` with the OLD position until the target fragment has
 * loaded, and a naive mirror copies that value straight back into the store.
 *
 * This test drives a fake HTMLAudioElement through the exact sequence:
 *
 *   1. playback sits at 30s and reports it;
 *   2. the user commits a seek to 3600s;
 *   3. the element fires several stale `timeupdate` events at 30s;
 *   4. the element finally arrives at 3600s.
 *
 * It fails if the store's `time` ever returns to 30s after the seek, which is
 * precisely the regression the user saw.
 *
 * The store is closure-private, so this renders the deck, takes the component's
 * own reachable surface, and observes the snapshot through React's store hook.
 */
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const checks = [];
const check = (label, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ' + detail}`);
};

// --- a fake audio element --------------------------------------------------
class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = 3600;
    this.paused = true;
    this.ended = false;
    this.src = '';
    this.volume = 1;
    this.muted = false;
    this.error = null;
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) {
    this.listeners.get(name)?.delete(fn);
  }
  /** Fire an event as the browser would. */
  emit(name) {
    for (const fn of this.listeners.get(name) ?? []) fn();
  }
  /** Report a position the way the media element does, then notify. */
  report(seconds) {
    this.currentTime = seconds;
    this.emit('timeupdate');
  }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  load() {}
  removeAttribute() {}
}

// --- stub React that keeps state and reruns render -------------------------
let rerender = () => {};
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => {
    const slot = { value: typeof initial === 'function' ? initial() : initial };
    const set = (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; };
    return [slot.value, set];
  },
  useEffect: (fn) => { fn(); },
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useRef: (initial) => {
    const ref = { current: initial };
    // The deck attaches the real element through a ref; capture it.
    if (initial === null) {
      queueMicrotask(() => {
        if (ref.current !== null && typeof ref.current.addEventListener !== 'function') return;
      });
    }
    return ref;
  },
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

// --- reach the store through the component tree ----------------------------
// BackgroundAudio renders the single audio element and attaches it on mount.
// Rendering it produces { type: 'audio', props: { ref } }; the fake element is
// then placed on that ref and attached, which is what React does once the node
// exists.
const audio = new FakeAudio();
const tree = plugin.__test_BackgroundAudio();
const audioRef = tree?.props?.ref;
check('the player renders an audio element', tree?.type === 'audio' && audioRef !== undefined, String(tree?.type));

audioRef.current = audio;
plugin.__test_store.attach(audio);

const store = plugin.__test_store;

// --- 1. playback sits at 30s ----------------------------------------------
audio.report(30);
check('the store mirrors the initial position', store.getSnapshot().time === 30, String(store.getSnapshot().time));

// --- 2. the user commits a seek far forward -------------------------------
const TARGET = 3600 - 60;
store.seek(TARGET, true);
check('the requested position is shown at once', store.getSnapshot().time === TARGET, String(store.getSnapshot().time));

// --- 3. the element keeps reporting the OLD position ----------------------
// This is what a DASH stream does while the target fragment downloads.
const observed = [];
for (let i = 0; i < 6; i += 1) {
  audio.report(30); // stale
  observed.push(store.getSnapshot().time);
}
check(
  'stale timeupdate reports never move the bar backwards',
  observed.every((t) => t === TARGET),
  JSON.stringify(observed),
);
check(
  'the bar never returns to the pre-seek position',
  !observed.includes(30),
  'that jump-back is the reported bug',
);

// --- 4. playback finally arrives -----------------------------------------
audio.report(TARGET + 0.4);
check('the bar follows the element once it arrives', Math.abs(store.getSnapshot().time - (TARGET + 0.4)) < 0.6, String(store.getSnapshot().time));

// The guard must be released: further reports track normally.
audio.report(TARGET + 12);
check('the guard releases after arrival', Math.abs(store.getSnapshot().time - (TARGET + 12)) < 0.6, String(store.getSnapshot().time));

// --- 5. a guard must not outlive its window ------------------------------
// The store's clock is injectable in principle; drive the guard directly.
store.seek(100, true);
store.seekGuard.until = 0; // already expired
audio.report(30);
check('an expired guard stops overriding the element', store.getSnapshot().time === 30, String(store.getSnapshot().time));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} seek-guard checks passed`);
process.exit(failed === 0 ? 0 : 1);
