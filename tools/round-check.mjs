/**
 * Prove the deck's discs are geometrically round, by inspecting the SVG the
 * component actually renders.
 *
 * Two earlier attempts failed for layout reasons a screenshot would have caught
 * immediately but that no CSS-level assertion could: an animated transform
 * overwrote a centring offset, and an absolutely-positioned box with both `top`
 * and `bottom` pinned solved its height from that constraint, ignoring
 * `aspect-ratio`. Both produced an oval.
 *
 * The current deck draws every disc as an SVG <circle>. A circle cannot be
 * stretched by the CSS box model, by a parent's aspect ratio, or by a missing
 * aspect-ratio feature: rx and ry are equal by definition. This test renders the
 * real component against stub React and asserts that structural fact, plus the
 * properties that keep the rotation from moving anything.
 */
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

// --- a React stub just complete enough to render the component -------------
const states = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => {
    const slot = { value: typeof initial === 'function' ? initial() : initial };
    states.push(slot);
    return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
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
  location: { origin: 'http://127.0.0.1:51803' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
globalThis.fetch = async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });

new Function(source)();
const plugin = registry.get('dsh-plugin-vinyl-player')((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require(${name})`);
});

const checks = [];
const check = (label, condition, detail) => {
  checks.push({ label, condition: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
};

// --- render the deck -------------------------------------------------------
const deck = plugin.__test_Turntable({
  title: 'Test record',
  cover: '',
  armed: true,
  playing: false,
  dropActive: false,
  speed: 33,
  volume: 0.8,
  muted: false,
  playLabel: 'Play',
  pauseLabel: 'Pause',
  emptyLabel: 'Empty',
  armLabel: 'Drag the arm',
  speedLabel: 'Speed',
  volumeLabel: 'Volume',
  onToggle: () => {},
  onEngage: () => {},
  onDrop: () => {},
  onDropActive: () => {},
  onSpeed: () => {},
  onVolume: () => {},
  onMute: () => {},
});

check('the deck renders', deck !== null && typeof deck === 'object');

// --- walk the tree ---------------------------------------------------------
const nodes = [];
const walk = (node, depth = 0) => {
  if (node === null || node === undefined || depth > 30) return;
  if (Array.isArray(node)) { node.forEach((child) => walk(child, depth + 1)); return; }
  if (typeof node !== 'object') return;
  nodes.push(node);
  if (typeof node.type === 'function') { walk(node.type(node.props), depth + 1); return; }
  walk(node.children, depth + 1);
};
walk(deck);

const svgRoot = nodes.find((node) => node.type === 'svg');
check('the deck draws an SVG', svgRoot !== undefined);
check('the SVG scales without distorting', svgRoot?.props?.preserveAspectRatio === 'xMidYMid meet', svgRoot?.props?.preserveAspectRatio);

const circles = nodes.filter((node) => node.type === 'circle');
check('the deck draws circles, not styled boxes', circles.length >= 20, `${circles.length} circles`);

// --- EVERY disc is a <circle>: rx and ry cannot differ ---------------------
const discBodies = circles.filter((node) => Number(node.props.r) >= 140);
check('the record body is a circle with one radius', discBodies.length >= 1, discBodies.map((c) => `r=${c.props.r}`).join(', '));

// A <circle> carrying an rx/ry attribute would be malformed; assert none do.
const distorted = circles.filter((node) => node.props.rx !== undefined || node.props.ry !== undefined);
check('no circle carries ellipse radii', distorted.length === 0, distorted.map((c) => `${c.props.rx}/${c.props.ry}`).join(', '));

// No CSS transform may squash a disc into an ellipse. This deck is drawn in a
// FRONT view, so no projection exists at all: every disc is a true circle and
// there is no scale on any axis.
const scaledCircles = circles.filter((node) => /scale\(\s*[^,)]*[, ][^)]*\)/.test(node.props.style?.transform ?? node.props.transform ?? ''));
check('no individual circle is squashed by its own transform', scaledCircles.length === 0, String(scaledCircles.length));

const projections = nodes.filter((node) => /scale\([^)]*,\s*0?\.\d+\)/.test(node.props.transform ?? ''));
check('the deck applies no perspective projection (front view)', projections.length === 0, `${projections.length} projected group(s)`);

// A front view means the platter is a circle, not an ellipse.
const platter = nodes.find((node) => node.type === 'circle' && Number(node.props.r) >= 160);
check('the platter is a circle', platter !== undefined, `r=${platter?.props?.r}`);
const ellipses = nodes.filter((node) => node.type === 'ellipse');
// A single flat shadow under the cabinet is fine; an ellipse standing in for a
// record or platter is not.
const bigEllipses = ellipses.filter((node) => Number(node.props.rx) > 100);
check('no ellipse stands in for a disc', bigEllipses.length === 0, `${ellipses.length} ellipse(s), ${bigEllipses.length} disc-sized`);

// --- the rotation must not displace the disc ------------------------------
const spin = nodes.find((node) => String(node.props.className ?? '').includes('vr-disc-spin'));
check('the record has a spinning group', spin !== undefined, String(spin?.props?.className));
check(
  'the spin group pins its origin to its own fill box',
  /transform-box:fill-box/.test(source) && /transform-origin:center/.test(source),
  source.match(/\.vr-disc-spin\{[^}]*\}/)?.[0],
);
check(
  'the spin group carries no layout transform',
  spin?.props?.transform === undefined && spin?.props?.style?.transform === undefined,
  JSON.stringify(spin?.props?.style ?? {}),
);
check('the spin animation is a pure rotate', /@keyframes vr-spin\{from\{transform:rotate\(0\)\}to\{transform:rotate\(360deg\)\}\}/.test(source));

// The disc artwork must be drawn around local (0,0), so the fill-box centre the
// rotation uses IS the disc centre.
const discRadii = nodes
  .filter((node) => node.type === 'circle' && node.props.cx === 0 && node.props.cy === 0)
  .map((node) => Number(node.props.r));
check('the disc artwork is drawn around its own origin', discRadii.length >= 15, `${discRadii.length} concentric circles`);

// --- the disc body is not a CSS box at all --------------------------------
check('no CSS rule sizes the record body any more', !/\.vr-vinyl\{/.test(source) || /\.vr-vinyl\{/.test(source) === false);
check('the old disc box styles are gone', !/\.vr-platter\{position:absolute/.test(source));

// --- the drop target is round too -----------------------------------------
const dropTarget = nodes.find((node) => String(node.props.className ?? '').includes('vr-drop-target'));
check('the drop target is an SVG circle', dropTarget?.type === 'circle', String(dropTarget?.type));
check('the drop target has a single radius', dropTarget?.props?.r !== undefined && dropTarget?.props?.rx === undefined);

const failed = checks.filter((entry) => !entry.condition);
console.log(`\n${checks.length - failed.length}/${checks.length} roundness checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
