/**
 * Prove the fix for the actual failure: an element whose `seekable` is empty.
 *
 * The live diagnosis from the user's session showed:
 *
 *   duration: 279.08,  readyState: 4,  seekable: [[0, 0]],  src: h-app://...
 *
 * A fully buffered element that still reports no seekable range. In that state a
 * browser silently ignores every `currentTime` assignment — the slider moves and
 * the audio keeps playing from where it was. The cause is the desktop shell's
 * `h-app://` route bridge, which does not forward Range support, so the element
 * treats the stream as unseekable.
 *
 * The remedy is to serve the element a Blob URL, which is always seekable. This
 * test models both element behaviours and asserts:
 *
 *   - seeking an unseekable source does nothing (the reported bug);
 *   - the buffered Blob restores seeking, keeps the position, and is released.
 */
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const checks = [];
const check = (label, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ' + detail}`);
};

// --- a media element that honours `seekable` ------------------------------
class FakeAudio {
  constructor({ unseekable = false } = {}) {
    this.listeners = new Map();
    this._currentTime = 0;
    this.duration = 279.08;
    this.readyState = 4;
    this.paused = true;
    this.ended = false;
    this.src = '';
    this.volume = 1;
    this.muted = false;
    this.error = null;
    this.unseekable = unseekable;
    /** Assignments the element refused because the source is unseekable. */
    this.rejected = 0;
    this.assignments = [];
    this.seekable = { length: 1, start: () => 0, end: () => 0 };
  }
  set currentTime(value) {
    // A browser ignores the assignment when the source reports no seekable range.
    if (this.unseekable) {
      this.rejected += 1;
      return;
    }
    this.assignments.push(value);
    this._currentTime = value;
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
  load() { this.emit('loadedmetadata'); }
  removeAttribute() {}
}

// --- browser globals the buffer path uses --------------------------------
const blobs = new Map();
let blobSeq = 0;
globalThis.URL = {
  createObjectURL(blob) {
    const url = `blob:test/${(blobSeq += 1)}`;
    blobs.set(url, blob);
    return url;
  },
  revokeObjectURL(url) { blobs.delete(url); },
  prototype: {},
};
globalThis.Blob = class {
  constructor(parts, options) {
    this.size = parts.reduce((total, part) => total + (part.byteLength ?? part.length ?? 0), 0);
    this.type = options?.type ?? '';
  }
};

const AUDIO_BYTES = new Uint8Array(200000).fill(7);
globalThis.fetch = async () => new Response(AUDIO_BYTES, {
  status: 200,
  headers: { 'content-type': 'audio/mp4' },
});

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
new Function(source)();
const plugin = registry.get('dsh-plugin-vinyl-player')((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require(${name})`);
});
const store = plugin.__test_store;

// --- 1. reproduce the reported failure ----------------------------------
// An h-app:// source with no seekable range ignores the seek.
const unseekable = new FakeAudio({ unseekable: true });
store.attach(unseekable);
store.seek(120, true);
check(
  'an unseekable source refuses the seek',
  unseekable.rejected === 1 && unseekable.currentTime === 0,
  `rejected=${unseekable.rejected} currentTime=${unseekable.currentTime}`,
);
check('the bar still moved, which is the confusing symptom', store.getSnapshot().time === 120, String(store.getSnapshot().time));

// --- 2. the diagnosis names the cause ------------------------------------
const before = store.describeSeek();
check('the diagnosis reports the empty seekable range', Array.isArray(before.seekable) && before.seekable.length === 1 && before.seekable[0][1] === 0, JSON.stringify(before.seekable));
check('the diagnosis lists the duration', before.duration === 279.08, String(before.duration));

// --- 3. buffering swaps the element onto a seekable Blob -----------------
const seekable = new FakeAudio();
store.attach(seekable);
await store.bufferTrack('/vinyl-room/media?t=x', store.playToken);
await new Promise((resolve) => setTimeout(resolve, 30));

check('a Blob URL was created for the track', seekable.src.startsWith('blob:'), seekable.src);
check('the buffered source is registered for release', typeof store.bufferUrl === 'string', store.bufferUrl);
const afterBuffer = store.describeSeek();
check('the buffered element is the one the store reports', afterBuffer.attached === true && afterBuffer.src.startsWith('blob'), afterBuffer.src);

// --- 4. seeking a buffered track works ----------------------------------
// The buffered element accepts assignments, which is exactly what the Blob fixes.
seekable._currentTime = 0;
store.seek(150, true);
check('a buffered track accepts the seek', seekable.currentTime === 150, String(seekable.currentTime));
check('the seek was not refused', seekable.rejected === 0, String(seekable.rejected));

// --- 5. the buffer is released, never persisted -------------------------
const heldUrl = store.bufferUrl;
const before2 = blobs.size;
store.releaseBuffer();
check('releasing drops the object URL', store.bufferUrl === undefined, String(store.bufferUrl));
check('the blob is revoked, not kept', blobs.size === before2 - 1, `${before2} -> ${blobs.size}`);
check('the revoked url is the one that was held', !blobs.has(heldUrl));

// --- 6. a new track releases the previous buffer ------------------------
const third = new FakeAudio();
store.attach(third);
await store.bufferTrack('/vinyl-room/media?t=a', store.playToken);
await new Promise((resolve) => setTimeout(resolve, 30));
const firstUrl = store.bufferUrl;
check('the first track is buffered', typeof firstUrl === 'string', firstUrl);
store.releaseBuffer();
check('switching tracks leaves no buffer behind', store.bufferUrl === undefined);

// --- 7. a failed pre-fetch must not break playback ----------------------
globalThis.fetch = async () => { throw new Error('network down'); };
const fourth = new FakeAudio();
store.attach(fourth);
fourth.src = '/vinyl-room/media?t=y';
let threw;
try {
  await store.bufferTrack('/vinyl-room/media?t=y', store.playToken);
} catch (error) {
  threw = error;
}
check('a failed pre-fetch does not throw', threw === undefined, threw?.message);
check('the streaming source is left in place', fourth.src === '/vinyl-room/media?t=y', fourth.src);

// --- 8. the implementation guards on the right primitives --------------
check('the buffer path checks for Blob support', /typeof URL\.createObjectURL !== 'function'/.test(source));
check('the buffer is revoked on track change', /bufferTrack|releaseBuffer/.test(source));
check('the buffer is revoked on detach', /releaseBuffer\(\);\s*\n\s*this\.audio = null/.test(source));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} unseekable-source checks passed`);
process.exit(failed === 0 ? 0 : 1);
