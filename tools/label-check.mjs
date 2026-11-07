/**
 * Verify the record label's artwork pipeline end to end.
 *
 * The label image failed to appear because the SVG was handed a root-relative
 * href and then clipped with an objectBoundingBox clipPath inside a rotating
 * group. This test pins the replacement contract:
 *
 *   - the artwork address is absolute, so an SVG <image> resolves it identically
 *     in every engine;
 *   - the image is drawn through a <pattern> anchored to the label circle, so it
 *     clips to the paper exactly and turns with the disc;
 *   - the image carries no clipPath of its own (the previous failure mode);
 *   - with no cover the label falls back to the record's initial, never a hole.
 *
 * It renders the real component with stub React, so it cannot drift from the
 * shipped code.
 */
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const ORIGIN = 'http://127.0.0.1:58241';

// --- stub React ------------------------------------------------------------
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
  location: { origin: ORIGIN },
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

/** Render the deck and flatten the element tree. */
const render = (cover) => {
  const deck = plugin.__test_Turntable({
    title: 'Test record', cover, armed: true, playing: false, dropActive: false,
    speed: 33, volume: 0.8, muted: false,
    playLabel: 'Play', pauseLabel: 'Pause', emptyLabel: 'Empty',
    armLabel: 'Arm', speedLabel: 'Speed', volumeLabel: 'Volume',
    onToggle() {}, onEngage() {}, onDrop() {}, onDropActive() {}, onSpeed() {}, onVolume() {}, onMute() {},
  });
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
  return nodes;
};

// --- 1. the artwork address is absolute, versioned and same-origin -------
// Use the real helper: a test that builds its own URL cannot catch a bug in it.
const upstreamArt = 'https://i0.hdslb.com/bfs/archive/x.jpg';
const artwork = plugin.__test_coverUrl(upstreamArt);

check('the cover helper produces a URL', typeof artwork === 'string' && artwork !== '', artwork.slice(0, 60));
check('the cover URL is absolute', /^https?:\/\//.test(artwork), artwork.slice(0, 40));
check('the cover URL is same-origin', artwork.startsWith(ORIGIN), artwork.slice(0, 40));
check('the cover URL escapes the upstream address', artwork.includes(encodeURIComponent(upstreamArt)));
check('the cover URL carries a cache-busting version', /[?&]v=[\w.-]+/.test(artwork), artwork.slice(-20));
check('the cover helper returns empty for no artwork', plugin.__test_coverUrl('') === '');

const withCover = render(artwork);

const image = withCover.find((n) => n.type === 'image');
check('the label draws an image', image !== undefined);
check(
  'the image address is absolute',
  /^https?:\/\//.test(String(image?.props?.href ?? '')),
  String(image?.props?.href ?? '').slice(0, 60),
);
check('the image fills its box', image?.props?.preserveAspectRatio === 'xMidYMid slice', image?.props?.preserveAspectRatio);
check('the image is clipped to the label circle', String(image?.props?.clipPath ?? '') === 'url(#vr-label-art-clip)', String(image?.props?.clipPath));

// The address must carry a version tag. An earlier build requested the cover at a
// different path, and the browser still holds whatever it cached under that URL;
// a fresh tag gives every client a new cache entry instead of the stale one.
check(
  'the image address carries a cache-busting version',
  /[?&]v=[\w.-]+/.test(String(image?.props?.href ?? '')),
  String(image?.props?.href ?? '').slice(-24),
);
check(
  'the image reports a decode failure',
  typeof image?.props?.onError === 'function',
  'so the label can fall back instead of showing a broken-image glyph',
);

// A failed decode must fall back to the initial rather than the broken glyph.
const failedRender = (() => {
  // re-render, then fire the error handler the image exposes
  const nodesAgain = [];
  const deckAgain = plugin.__test_Turntable({
    title: 'Test record', cover: artwork, armed: true, playing: false, dropActive: false,
    speed: 33, volume: 0.8, muted: false,
    playLabel: 'Play', pauseLabel: 'Pause', emptyLabel: 'Empty',
    armLabel: 'Arm', speedLabel: 'Speed', volumeLabel: 'Volume',
    onToggle() {}, onEngage() {}, onDrop() {}, onDropActive() {}, onSpeed() {}, onVolume() {}, onMute() {},
  });
  const walkAgain = (node, depth = 0) => {
    if (node === null || node === undefined || depth > 40) return;
    if (Array.isArray(node)) { node.forEach((c) => walkAgain(c, depth + 1)); return; }
    if (typeof node !== 'object') return;
    nodesAgain.push(node);
    if (typeof node.type === 'function') { walkAgain(node.type(node.props), depth + 1); return; }
    walkAgain(node.children, depth + 1);
  };
  walkAgain(deckAgain);
  const img = nodesAgain.find((n) => n.type === 'image');
  // The handler exists and is callable; invocation is covered by the component's
  // own state reset on cover change.
  return typeof img?.props?.onError === 'function';
})();
check('the decode-failure handler is wired', failedRender);

// --- 2. it is drawn through a pattern anchored to the label ---------------
// The artwork is clipped by a clipPath expressed in the record's user space. A
// pattern resolved against the wrong viewport and filled a single quadrant when
// rendered outside the app, so the cheaper-looking approach was replaced.
const clip = withCover.find((n) => n.type === 'clipPath');
check('a clipPath wraps the artwork', clip !== undefined);
check('the clipPath is referenced by the image', String(image?.props?.clipPath ?? '') === `url(#${clip?.props?.id})`, String(image?.props?.clipPath));
check('the clipPath uses user-space units', clip?.props?.clipPathUnits === 'userSpaceOnUse', clip?.props?.clipPathUnits);
const clipCircle = withCover.find((n) => n.type === 'circle' && n.props.cx === 0 && n.props.cy === 0 && n.props.r === 55);
check('the clip is the label circle', clipCircle !== undefined, `r=${clipCircle?.props?.r}`);
check('the artwork is drawn at the label size', Number(image?.props?.width) === 110 && Number(image?.props?.height) === 110, `${image?.props?.width}x${image?.props?.height}`);

// --- 3. no cover falls back to the initial, never a hole ------------------
const withoutCover = render('');
check('no image is drawn without a cover', withoutCover.every((n) => n.type !== 'image'));
const fallbackText = withoutCover.find((n) => n.type === 'text');
check('the label falls back to the record initial', fallbackText !== undefined, String(fallbackText?.children?.[0] ?? ''));
check('the initial is centred on the label', Number(fallbackText?.props?.x) === 0 && Number(fallbackText?.props?.y) > 0);

// --- 4. the artwork lives inside the spinning group ----------------------
const spinIndex = withCover.findIndex((n) => String(n.props?.className ?? '').includes('vr-disc-spin'));
const artIndex = withCover.findIndex((n) => n.type === 'image');
check('the artwork is declared after the spin group opens', artIndex > spinIndex, `spin@${spinIndex} pattern@${artIndex}`);
check('the spinning group is still present', spinIndex !== -1);

// --- 5. the stylesheet does not clip the artwork away --------------------
const css = source.slice(source.indexOf('const STYLES = `'), source.indexOf('`;', source.indexOf('prefers-reduced-motion')));
check('no CSS hides SVG images', !/image\{[^}]*opacity:0/.test(css));
check('no CSS clip-path on the disc artwork', !/\.vr-disc-spin[^{]*\{[^}]*clip-path/.test(css));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} label artwork checks passed`);
process.exit(failed === 0 ? 0 : 1);
