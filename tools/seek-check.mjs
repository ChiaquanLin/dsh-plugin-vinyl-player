/**
 * Verify the seek bar can actually be dragged.
 *
 * The bar has two jobs that pull in opposite directions, and each broke once:
 *
 *   - it must follow the pointer while dragging, even though `timeupdate` keeps
 *     overwriting the track position several times a second;
 *   - it must not write `currentTime` on every pointer move. On a six-hour
 *     recording that re-decodes the stream and the thumb lags behind the pointer,
 *     so the drag appears stuck.
 *
 * The fix previews during the gesture and commits exactly once on release. This
 * test drives the real component through that lifecycle with stub React, invoking
 * the handlers the way a browser would.
 */
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// --- stub React with usable state, so scrub state behaves ------------------
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => {
    const slot = { value: typeof initial === 'function' ? initial() : initial };
    const set = (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; };
    return [slot.value, set];
  },
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

const checks = [];
const check = (label, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ' + detail}`);
};

// --- render the bar and collect its input element --------------------------
const DURATION = 6 * 60 * 60; // a six-hour compilation: the case that stalled
const RECT = { left: 100, width: 300 };
const pointerEvent = (clientX) => ({
  clientX,
  pointerId: 1,
  currentTarget: {
    getBoundingClientRect: () => RECT,
    setPointerCapture: () => {},
    hasPointerCapture: () => true,
    releasePointerCapture: () => {},
  },
});
const calls = [];
const bar = plugin.__test_SeekBar({
  time: 0,
  duration: DURATION,
  disabled: false,
  label: 'Position',
  onSeek: (seconds, commit) => calls.push({ seconds, commit }),
});

const collect = (node, out = []) => {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) { node.forEach((c) => collect(c, out)); return out; }
  if (typeof node === 'object') { out.push(node); collect(node.children, out); }
  return out;
};

const nodes = collect(bar);
const input = nodes.find((n) => n.type === 'input');
check('the bar renders a range input', input !== undefined && input.props.type === 'range', input?.props?.type);
check('the range spans the whole track', Number(input?.props?.max) === DURATION, String(input?.props?.max));

// --- the track shows a filled played portion ------------------------------
// The fill is a CSS custom property so it follows the thumb without relayout.
check(
  'the bar exposes its played fraction',
  typeof input?.props?.style?.['--vr-progress'] === 'string',
  input?.props?.style?.['--vr-progress'],
);
check(
  'the filled fraction is a percentage',
  /^\d+(\.\d+)?%$/.test(String(input?.props?.style?.['--vr-progress'] ?? '')),
  input?.props?.style?.['--vr-progress'],
);

// A bar a quarter through its track reports 25%.
const quarter = collect(plugin.__test_SeekBar({
  time: DURATION / 4, duration: DURATION, disabled: false, label: 'P', onSeek: () => {},
})).find((n) => n.type === 'input');
check('the fill tracks the current position', quarter?.props?.style?.['--vr-progress'] === '25%', quarter?.props?.style?.['--vr-progress']);

// During a drag the fill follows the preview, not the audio clock. The stub
// useState does not re-render, so the check drives the preview and reads the
// value the component reports on the next render pass.
{
  const clock = [];
  const barDrag = plugin.__test_SeekBar({
    time: 0, duration: DURATION, disabled: false, label: 'P',
    onSeek: (seconds, commit) => clock.push({ seconds, commit }),
  });
  const inputDrag = collect(barDrag).find((n) => n.type === 'input');
  inputDrag.props.onPointerDown(pointerEvent(100));
  inputDrag.props.onPointerMove(pointerEvent(250));
  const previewed = clock[clock.length - 1];
  check(
    'the drag preview reaches half the track',
    previewed?.commit === false && Math.abs(previewed.seconds - DURATION / 2) < DURATION * 0.02,
    JSON.stringify(previewed),
  );
  check(
    'the bar reports its fraction as a percentage on every render',
    /^\d+(\.\d+)?%$/.test(String(input.props?.style?.['--vr-progress'] ?? '')),
    String(input.props?.style?.['--vr-progress']),
  );
}

// --- the grey buffer band ---------------------------------------------------
// A second fill marks what has been downloaded, so a listener can tell whether a
// jump will be instant. It must never sit behind the thumb.
const buf = collect(plugin.__test_SeekBar({
  time: 60, buffered: 120, duration: 600, disabled: false, label: 'P', onSeek: () => {},
})).find((n) => n.type === 'input');
check('the bar exposes a buffered fraction', typeof buf?.props?.style?.['--vr-buffered'] === 'string', buf?.props?.style?.['--vr-buffered']);
check('the buffered fraction is 20% of a 600s track', buf?.props?.style?.['--vr-buffered'] === '20%', buf?.props?.style?.['--vr-buffered']);
check('the played fraction is 10%', buf?.props?.style?.['--vr-progress'] === '10%', buf?.props?.style?.['--vr-progress']);

// A buffer that lags the thumb must not be drawn behind it.
const behind = collect(plugin.__test_SeekBar({
  time: 300, buffered: 60, duration: 600, disabled: false, label: 'P', onSeek: () => {},
})).find((n) => n.type === 'input');
const behindNum = parseFloat(String(behind?.props?.style?.['--vr-buffered'] ?? '0'));
const thumbNum = parseFloat(String(behind?.props?.style?.['--vr-progress'] ?? '0'));
check('the buffer is never drawn behind the thumb', behindNum >= thumbNum, buf + ' vs ' + thumbNum);

// A fully buffered track reports the whole duration.
const full = collect(plugin.__test_SeekBar({
  time: 10, buffered: 600, duration: 600, disabled: false, label: 'P', onSeek: () => {},
})).find((n) => n.type === 'input');
check('a fully buffered track fills the bar', full?.props?.style?.['--vr-buffered'] === '100%', full?.props?.style?.['--vr-buffered']);

// No buffered data must degrade to the played fill, not to a negative width.
const none = collect(plugin.__test_SeekBar({
  time: 30, duration: 600, disabled: false, label: 'P', onSeek: () => {},
})).find((n) => n.type === 'input');
check('a missing buffer does not invert the bar', parseFloat(String(none?.props?.style?.['--vr-buffered'] ?? '0')) >= parseFloat(String(none?.props?.style?.['--vr-progress'] ?? '0')), String(none?.props?.style?.['--vr-buffered']));

// --- a full pointer drag: down -> move -> move -> up ----------------------
let thrown;
try {
  input.props.onPointerDown(pointerEvent(100));
  check('pointer down starts a drag without seeking yet', calls.length === 0, `${calls.length} call(s)`);

  // Move to the middle of the bar.
  input.props.onPointerMove(pointerEvent(250));
  check('the drag previews a position', calls.length === 1, JSON.stringify(calls[0]));
  check('preview is marked as not committed', calls[0]?.commit === false, String(calls[0]?.commit));
  check(
    'the previewed position matches the pointer',
    Math.abs(calls[0].seconds - DURATION / 2) < DURATION * 0.02,
    `${calls[0]?.seconds} vs ${DURATION / 2}`,
  );

  // Move again: another preview, still no commit.
  input.props.onPointerMove(pointerEvent(400));
  check('a second move previews again', calls.length === 2, `${calls.length}`);
  check('no commit has happened during the drag', calls.every((c) => c.commit === false));

  // Release: exactly one commit, at the last previewed position.
  input.props.onPointerUp(pointerEvent(400));
  const committed = calls.filter((c) => c.commit === true);
  check('release commits exactly once', committed.length === 1, `${committed.length} commit(s)`);
  check(
    'the committed position is the last previewed one',
    committed[0]?.seconds === calls[1]?.seconds,
    `${committed[0]?.seconds} vs ${calls[1]?.seconds}`,
  );
} catch (error) {
  thrown = error;
}
check('the drag lifecycle does not throw', thrown === undefined, thrown?.message);

// --- a cancelled drag must not move playback ------------------------------
const cancelled = [];
const bar2 = plugin.__test_SeekBar({
  time: 0, duration: DURATION, disabled: false, label: 'Position',
  onSeek: (seconds, commit) => cancelled.push({ seconds, commit }),
});
const input2 = collect(bar2).find((n) => n.type === 'input');
input2.props.onPointerDown(pointerEvent(100));
input2.props.onPointerMove(pointerEvent(250));
input2.props.onPointerCancel(pointerEvent(250));
check('a cancelled drag commits nothing', cancelled.every((c) => c.commit === false), JSON.stringify(cancelled));

// --- a plain click (no drag) still seeks -----------------------------------
const clicks = [];
const bar3 = plugin.__test_SeekBar({
  time: 0, duration: DURATION, disabled: false, label: 'Position',
  onSeek: (seconds, commit) => clicks.push({ seconds, commit }),
});
const input3 = collect(bar3).find((n) => n.type === 'input');
input3.props.onInput({ target: { value: '3600' } });
check('clicking the track seeks immediately', clicks.length === 1 && clicks[0].commit === true, JSON.stringify(clicks[0]));
check('the clicked position is used', clicks[0]?.seconds === 3600, String(clicks[0]?.seconds));

// --- keyboard seeking commits too -----------------------------------------
const keys = [];
const bar4 = plugin.__test_SeekBar({
  time: 0, duration: DURATION, disabled: false, label: 'Position',
  onSeek: (seconds, commit) => keys.push({ seconds, commit }),
});
const input4 = collect(bar4).find((n) => n.type === 'input');
input4.props.onChange({ target: { value: '60' } });
check('keyboard changes seek immediately', keys.length === 1 && keys[0].commit === true, JSON.stringify(keys[0]));

// --- a drag that leaves the bar keeps working -----------------------------
const outside = [];
const bar5 = plugin.__test_SeekBar({
  time: 0, duration: DURATION, disabled: false, label: 'Position',
  onSeek: (seconds, commit) => outside.push({ seconds, commit }),
});
const input5 = collect(bar5).find((n) => n.type === 'input');
input5.props.onPointerDown(pointerEvent(100));
input5.props.onPointerMove(pointerEvent(50));   // left of the track
const leftmost = outside[outside.length - 1];
check('dragging left of the bar clamps to zero', leftmost?.seconds === 0, String(leftmost?.seconds));
input5.props.onPointerMove(pointerEvent(500));  // right of the track
const rightmost = outside[outside.length - 1];
check('dragging right of the bar clamps to the duration', rightmost?.seconds === DURATION, String(rightmost?.seconds));

// --- a disabled bar ignores input ----------------------------------------
const idle = [];
const bar6 = plugin.__test_SeekBar({
  time: 0, duration: 0, disabled: true, label: 'Position',
  onSeek: (seconds, commit) => idle.push({ seconds, commit }),
});
const input6 = collect(bar6).find((n) => n.type === 'input');
check('a bar with no duration is disabled', input6?.props?.disabled === true);
check('a disabled bar still renders a usable max', Number(input6?.props?.max) >= 1, String(input6?.props?.max));

// --- the store must preview without touching the audio element -----------
const seekSource = source.slice(source.indexOf('seek(seconds, commit = true)'));
const seekBody = seekSource.slice(0, seekSource.indexOf('\n      }'));
check('the store previews the position on every drag step', /patch\(\{ time: target \}\)/.test(seekBody));
check('an uncommitted seek returns before moving playback', /if \(!commit\) return/.test(seekBody), 'guarded by commit');
check(
  'a committed seek records a guard before moving playback',
  /this\.seekGuard = \{ target, until: this\.now\(\) \+ SEEK_GUARD_MS \}[\s\S]*this\.applySeek\(audio, target\)/.test(seekBody),
  'guard precedes the move',
);
check(
  'the move is retried until the element accepts it',
  /applySeek\(audio, target, attempt = 0\)/.test(source),
  'a bare currentTime assignment is silently discarded before metadata',
);

// --- a committed seek must not be undone by the element's stale clock ------
// This is the bug the user reported: drag forward, release, bar jumps back to
// where the drag started. On a DASH stream the element keeps reporting the old
// position until the target fragment loads.
const syncSource = source.slice(source.indexOf('const sync = () => {'));
const syncBody = syncSource.slice(0, syncSource.indexOf('\n        };'));
check('the mirror checks for a pending seek', /const guard = this\.seekGuard/.test(syncBody));
check('a pending seek keeps the requested position', /time = guard\.target/.test(syncBody));
check('the guard clears once playback arrives', /Math\.abs\(reported - guard\.target\) <= SEEK_ARRIVED_S/.test(syncBody));
check('the guard expires rather than sticking forever', /this\.now\(\) >= guard\.until/.test(syncBody));
check('the guard window is long enough for a fragment load', Number(source.match(/SEEK_GUARD_MS = (\d+)/)?.[1]) >= 1000, source.match(/SEEK_GUARD_MS = (\d+)/)?.[1] + 'ms');

// --- switching tracks must not inherit a stale guard ----------------------
check('loading a new track clears the guard', /this\.seekGuard = undefined;[\s\S]{0,200}audio\.src = stream\.src/.test(source));
check('loading a new track drops the previous buffer', /this\.releaseBuffer\(\);\s*\n\s*audio\.src = stream\.src/.test(source));
check('clearing the shelf clears the guard', /this\.playToken \+= 1;[\s\S]{0,400}audio\.removeAttribute/.test(source));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} seek bar checks passed`);
process.exit(failed === 0 ? 0 : 1);
