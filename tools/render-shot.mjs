/**
 * Render the deck to a standalone SVG file that GitHub can display.
 *
 * The previous preview was the raw React tree serialised straight to disk: a
 * `<div class="vr-deck">` wrapping an `<svg>`. That is not a valid image — it has
 * no XML declaration, no `xmlns`, and a non-SVG root — so GitHub refused to
 * render it and the README showed a broken image.
 *
 * This produces a real image file instead: one `<svg>` root with the correct
 * namespace and dimensions, the deck's own artwork centred inside it, and a
 * background so the panel reads on both light and dark themes.
 *
 * Output: docs/deck.svg (the README screenshot).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSource = fs.readFileSync(path.join(here, '..', 'lib', 'client.js'), 'utf8');

// --- stub React, load the client half, render the deck ---------------------
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
new Function(clientSource)();
const plugin = registry.get('dsh-plugin-vinyl-player')((name) => {
  if (name === 'react') return React;
  throw new Error(`unexpected require(${name})`);
});

// Render the deck as it looks while a record is playing, so the screenshot shows
// the tonearm engaged rather than parked.
//
// The label artwork is normally a proxied JPEG. A screenshot must be a single
// self-contained file, so the cover is a small inline SVG data URI — a stand-in
// that looks like sleeve art and keeps the image dependency-free.
const coverArt = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
  <defs>
    <linearGradient id="a" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b1b4d"/>
      <stop offset="0.5" stop-color="#7a3b8f"/>
      <stop offset="1" stop-color="#e0685a"/>
    </linearGradient>
  </defs>
  <rect width="220" height="220" fill="url(#a)"/>
  <circle cx="110" cy="96" r="44" fill="#f7d9a8" opacity="0.92"/>
  <circle cx="110" cy="96" r="44" fill="none" stroke="#2b1b4d" stroke-width="3" opacity="0.35"/>
  <path d="M0 168 Q55 132 110 160 T220 148 L220 220 L0 220 Z" fill="#1b1030" opacity="0.82"/>
  <path d="M0 186 Q60 158 118 180 T220 172 L220 220 L0 220 Z" fill="#0e0819" opacity="0.9"/>
</svg>`)}`;

const deck = plugin.__test_Turntable({
  title: 'Nightfall Drive',
  cover: coverArt,
  armed: true,
  playing: true,
  dropActive: false,
  speed: 33,
  volume: 0.8,
  muted: false,
  playLabel: 'Play',
  pauseLabel: 'Pause',
  emptyLabel: 'Nothing on the platter',
  armLabel: 'Drag the arm',
  speedLabel: 'Speed',
  volumeLabel: 'Volume',
  onToggle() {},
  onEngage() {},
  onDrop() {},
  onDropActive() {},
  onSpeed() {},
  onVolume() {},
  onMute() {},
});

// --- serialise ------------------------------------------------------------
const VOID = new Set(['circle', 'rect', 'path', 'ellipse', 'line', 'polygon', 'polyline', 'image', 'stop', 'use']);
const ALIAS = {
  className: 'class',
  strokeWidth: 'stroke-width',
  strokeOpacity: 'stroke-opacity',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray',
  fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule',
  stopColor: 'stop-color',
  stopOpacity: 'stop-opacity',
  textAnchor: 'text-anchor',
  fontSize: 'font-size',
  fontWeight: 'font-weight',
  fontFamily: 'font-family',
  letterSpacing: 'letter-spacing',
  preserveAspectRatio: 'preserveAspectRatio',
  viewBox: 'viewBox',
  clipPath: 'clip-path',
  clipPathUnits: 'clipPathUnits',
  gradientUnits: 'gradientUnits',
  patternUnits: 'patternUnits',
  patternContentUnits: 'patternContentUnits',
  baseFrequency: 'baseFrequency',
  numOctaves: 'numOctaves',
  stdDeviation: 'stdDeviation',
  floodColor: 'flood-color',
  floodOpacity: 'flood-opacity',
  pointerEvents: 'pointer-events',
  transformOrigin: 'transform-origin',
};

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attrName = (key) => ALIAS[key] ?? (key.includes('-') ? key : key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));

const serialize = (node) => {
  if (node === null || node === undefined || node === false) return '';
  if (Array.isArray(node)) return node.map(serialize).join('');
  if (typeof node === 'string' || typeof node === 'number') return escape(node);
  if (typeof node !== 'object') return '';
  if (typeof node.type === 'function') return serialize(node.type(node.props));

  const attrs = [];
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'key' || key === 'ref' || key === 'children') continue;
    if (typeof value === 'function' || typeof value === 'object') continue;
    if (key === 'style') continue; // inline styles are presentation, not image data
    attrs.push(`${attrName(key)}="${escape(value)}"`);
  }
  const body = serialize(node.children ?? []);
  const open = `<${node.type}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
  if (VOID.has(node.type) && body === '') return `${open}/>`;
  return `${open}>${body}</${node.type}>`;
};

// The deck renders a wrapper div; the artwork is the <svg> inside it.
const findSvg = (node) => {
  if (node === null || node === undefined) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findSvg(child);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  if (node.type === 'svg') return node;
  if (typeof node.type === 'function') return findSvg(node.type(node.props));
  return findSvg(node.children);
};

const svg = findSvg(deck);
if (svg === null) throw new Error('the deck did not render an <svg>');

const [, , vbW, vbH] = String(svg.props.viewBox).split(/\s+/).map(Number);

// Compose the final image: a padded canvas with a soft background, the deck's
// contents translated into it, and a caption strip naming the panel.
const PAD = 24;
const CAPTION = 64;
const width = vbW + PAD * 2;
const height = vbH + PAD * 2 + CAPTION;

const content = serialize(svg.children ?? []);

const image = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="The vinyl player panel">
  <title>Vinyl player panel</title>
  <desc>A cartoon turntable with a record on the platter, a wooden cabinet, a speed selector and a volume knob, with the panel caption underneath.</desc>
  <defs>
    <linearGradient id="shot-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6f4f1"/>
      <stop offset="1" stop-color="#e8e3dc"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="18" fill="url(#shot-bg)"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="17" fill="none" stroke="#000" stroke-opacity="0.08"/>
  <g transform="translate(${PAD} ${PAD})">
    ${content}
  </g>
  <text x="${width / 2}" y="${vbH + PAD * 2 + 26}" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="17" font-weight="700" fill="#3f3a34">Vinyl player</text>
  <text x="${width / 2}" y="${vbH + PAD * 2 + 48}" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#6f675d">A Bilibili record player inside the DeepSeek Harness Web GUI</text>
</svg>
`;

const outDir = path.join(here, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'deck.svg');
fs.writeFileSync(outPath, image, 'utf8');

// --- self-check: the file must be a real, standalone image ---------------
const written = fs.readFileSync(outPath, 'utf8');
const checks = [
  ['valid XML declaration', written.startsWith('<?xml')],
  ['single svg root', (written.match(/<svg/g) ?? []).length === 1],
  ['declares the svg namespace', written.includes('xmlns="http://www.w3.org/2000/svg"')],
  ['declares width and height', /<svg[^>]*\swidth="\d+"/.test(written) && /<svg[^>]*\sheight="\d+"/.test(written)],
  ['has a title for screen readers', written.includes('<title>')],
  ['has no wrapper div', !written.includes('<div')],
  ['draws the cabinet', written.includes('vr-wood')],
  ['draws a true circle for the disc', /<circle[^>]*r="152"/.test(written)],
  ['draws no ellipse', !written.includes('<ellipse')],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed += 1;
}

console.log(`\nwrote ${path.relative(process.cwd(), outPath)} — ${written.length} bytes, ${width}x${height}`);
console.log(`${checks.length - failed}/${checks.length} image checks passed`);
process.exit(failed === 0 ? 0 : 1);
