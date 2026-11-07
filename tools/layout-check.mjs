/**
 * Verify the deck's layout arithmetic against the real constants.
 *
 * The layout is derived rather than eyeballed: a uniform margin, the disc's
 * diameter, a gap, the hardware row, and a matching margin, with the cabinet
 * sized from that sum. This script loads lib/client.js with stub React, then
 * re-derives every box and asserts containment and non-overlap.
 *
 * It exists because two real defects shipped: the cabinet was shorter than the
 * platter (the disc overhung its housing), and the speed selector was drawn on
 * top of the record.
 */
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// --- stub React, load the client half --------------------------------------
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

const deck = plugin.__test_Turntable({
  title: 'T', cover: '', armed: true, playing: false, dropActive: false,
  speed: 33, volume: 0.8, muted: false,
  playLabel: 'Play', pauseLabel: 'Pause', emptyLabel: 'Empty',
  armLabel: 'Arm', speedLabel: 'Speed', volumeLabel: 'Volume',
  onToggle() {}, onEngage() {}, onDrop() {}, onDropActive() {}, onSpeed() {}, onVolume() {}, onMute() {},
});

// --- flatten the tree ------------------------------------------------------
const nodes = [];
const walk = (node, depth = 0) => {
  if (node === null || node === undefined || depth > 40) return;
  if (Array.isArray(node)) { node.forEach((c) => walk(c, depth + 1)); return; }
  if (typeof node !== 'object') return;
  nodes.push(node);
  if (typeof node.type === 'function') { walk(node.type(node.props), depth + 1); return; }
  walk(node.children, depth + 1);
};
walk(deck);

const svg = nodes.find((n) => n.type === 'svg');
const vb = String(svg?.props?.viewBox ?? '');
const [, , W, H] = vb.split(/\s+/).map(Number);

const checks = [];
const check = (label, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

// --- the root svg must not rescale one axis -------------------------------
check('the svg viewBox parses', Number.isFinite(W) && Number.isFinite(H), vb);
check('the svg preserves aspect ratio', svg?.props?.preserveAspectRatio === 'xMidYMid meet', svg?.props?.preserveAspectRatio);

// --- gather the drawn boxes ------------------------------------------------
const circles = nodes.filter((n) => n.type === 'circle');
const rects = nodes.filter((n) => n.type === 'rect');

const boxOfCircle = (n) => ({
  l: n.props.cx - n.props.r, r: n.props.cx + n.props.r,
  t: n.props.cy - n.props.r, b: n.props.cy + n.props.r,
});
const boxOfRect = (n) => ({
  l: n.props.x, r: n.props.x + n.props.width,
  t: n.props.y, b: n.props.y + n.props.height,
});

// the cabinet is the big rounded rect sharing its fill with #vr-wood
const cabinetNode = rects
  .filter((n) => String(n.props.fill ?? '').includes('vr-wood') && Number(n.props.width) > 400)
  .sort((a, b) => Number(b.props.height) - Number(a.props.height))[0];
const cabinet = cabinetNode === undefined ? undefined : boxOfRect(cabinetNode);
check('the cabinet rect is found', cabinet !== undefined, cabinet ? `${cabinet.r - cabinet.l}x${cabinet.b - cabinet.t}` : 'missing');

// the platter is the largest circle
const platterNode = circles
  .filter((n) => /vr-platter/.test(String(n.props.fill ?? '')))
  .sort((a, b) => Number(b.props.r) - Number(a.props.r))[0];
const platter = platterNode === undefined ? undefined : boxOfCircle(platterNode);
check('the platter circle is found', platter !== undefined, platterNode ? `r=${platterNode.props.r}` : 'missing');

// the speed selector panel: the widest dark rect in the lower band
const speedPanelNode = rects
  .filter((n) => Number(n.props.width) === 92)
  .sort((a, b) => b.props.y - a.props.y)[0];
const speedPanel = speedPanelNode === undefined ? undefined : boxOfRect(speedPanelNode);

// the volume knob: a metal circle in the hardware row, below the disc. Selected
// by position rather than radius, because the arm base shares the same fill.
const knobNode = circles
  .filter((n) => /vr-metal/.test(String(n.props.fill ?? '')) && Number(n.props.cy) > (platter?.b ?? 0))
  .sort((a, b) => Number(b.props.r) - Number(a.props.r))[0];
const knob = knobNode === undefined ? undefined : boxOfCircle(knobNode);
check('the volume knob is found below the disc', knob !== undefined, knobNode ? `r=${knobNode.props.r} at (${knobNode.props.cx},${knobNode.props.cy})` : 'missing');

// --- containment -----------------------------------------------------------
if (cabinet !== undefined) {
  check('the cabinet sits inside the canvas',
    cabinet.l >= 0 && cabinet.r <= W && cabinet.t >= 0 && cabinet.b <= H,
    `x ${cabinet.l}..${cabinet.r} of ${W}, y ${cabinet.t}..${cabinet.b} of ${H}`);
}
if (cabinet !== undefined && platter !== undefined) {
  check('the platter fits horizontally inside the cabinet',
    platter.l >= cabinet.l && platter.r <= cabinet.r,
    `platter x ${platter.l}..${platter.r} in ${cabinet.l}..${cabinet.r}`);
  check('the platter fits vertically inside the cabinet',
    platter.t >= cabinet.t && platter.b <= cabinet.b,
    `platter y ${platter.t}..${platter.b} in ${cabinet.t}..${cabinet.b}`);

  const marginTop = platter.t - cabinet.t;
  check('there is a real margin above the disc', marginTop >= 12, `${marginTop}px`);
}

// --- the hardware must not sit on the record ------------------------------
if (platter !== undefined && speedPanel !== undefined) {
  const apart = speedPanel.t >= platter.b || speedPanel.b <= platter.t || speedPanel.l >= platter.r || speedPanel.r <= platter.l;
  check('the speed selector is clear of the platter', apart,
    `panel y ${speedPanel.t}..${speedPanel.b} vs platter y ${platter.t}..${platter.b}`);
}
if (platter !== undefined && knob !== undefined) {
  const apart = knob.t >= platter.b || knob.b <= platter.t || knob.l >= platter.r || knob.r <= platter.l;
  check('the volume knob is clear of the platter', apart,
    `knob y ${knob.t}..${knob.b} vs platter y ${platter.t}..${platter.b}`);
}
if (cabinet !== undefined && speedPanel !== undefined) {
  check('the speed selector is inside the cabinet',
    speedPanel.t >= cabinet.t && speedPanel.b <= cabinet.b && speedPanel.l >= cabinet.l && speedPanel.r <= cabinet.r,
    `y ${speedPanel.t}..${speedPanel.b} in ${cabinet.t}..${cabinet.b}`);
}
if (cabinet !== undefined && knob !== undefined) {
  check('the volume knob is inside the cabinet',
    knob.t >= cabinet.t && knob.b <= cabinet.b && knob.l >= cabinet.l && knob.r <= cabinet.r,
    `y ${knob.t}..${knob.b} in ${cabinet.t}..${cabinet.b}`);
}

// --- the arm base must be centred on the arm's pivot ----------------------
const armGroup = nodes.find((n) => String(n.props?.className ?? '').includes('vr-arm'));
const rotate = String(armGroup?.props?.transform ?? '').match(/rotate\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)/);
check('the arm declares its pivot in the rotation', rotate !== null, String(armGroup?.props?.transform));
if (rotate !== null) {
  const px = Number(rotate[2]);
  const py = Number(rotate[3]);
  // the housing circle centred on that same point proves the two agree
  const baseCircle = circles.find((n) => Number(n.props.cx) === px && Number(n.props.cy) === py && Number(n.props.r) >= 30);
  check('a housing circle is centred on the pivot', baseCircle !== undefined,
    baseCircle ? `r=${baseCircle.props.r} at (${px},${py})` : `no circle at (${px},${py})`);

  // and the collar drawn inside the rotating group sits on it too
  const collar = circles.find((n) => Number(n.props.cx) === px && Number(n.props.cy) === py && Number(n.props.r) < 20 && n.props.r > 8);
  check('the rotating collar sits on the pivot', collar !== undefined, collar ? `r=${collar.props.r}` : 'missing');

  if (cabinet !== undefined) {
    check('the pivot is inside the cabinet',
      px >= cabinet.l && px <= cabinet.r && py >= cabinet.t && py <= cabinet.b,
      `(${px},${py})`);
  }
  if (platterNode !== undefined) {
    const d = Math.hypot(px - platterNode.props.cx, py - platterNode.props.cy);
    check('the pivot is outside the disc', d > Number(platterNode.props.r), `distance ${d.toFixed(1)} > r ${platterNode.props.r}`);
  }
}

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} layout checks passed`);
process.exit(failed === 0 ? 0 : 1);
