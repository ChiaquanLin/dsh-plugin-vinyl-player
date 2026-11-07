/**
 * Render the panel layout diagram used in the README.
 *
 * A second image is worth the file: the deck alone does not show how the panel is
 * arranged, and the arrangement — deck in the middle, two shelves underneath — is
 * the answer to "what does this look like on screen".
 *
 * Output: docs/diagram.svg
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const W = 620;
const H = 560;

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One record sleeve, drawn as a rounded square with a disc peeking out. */
const sleeve = (x, y, size, tint) => `
    <g transform="translate(${x} ${y})">
      <rect width="${size}" height="${size}" rx="4" fill="${tint}" stroke="#2b2118" stroke-opacity="0.25"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.3}" fill="#141216" fill-opacity="0.75"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.1}" fill="${tint}"/>
    </g>`;

const shell = `
<div class="frame">
  <div class="searchbar">Search Bilibili music…</div>

  <div class="deck">
    <circle class="platter" cx="0" cy="0" r="74"/>
    <circle class="disc" cx="0" cy="0" r="66"/>
    <circle class="label" cx="0" cy="0" r="24"/>
    <circle class="hole" cx="0" cy="0" r="3"/>
    <g class="arm">
      <circle class="armbase" cx="112" cy="-72" r="17"/>
      <rect class="tube" x="110" y="-66" width="4" height="112" rx="2"/>
      <rect class="head" x="103" y="42" width="18" height="24" rx="4"/>
    </g>
    <g class="knob">
      <circle cx="112" cy="74" r="11"/>
      <rect x="110.6" y="66" width="2.8" height="9" rx="1.4" fill="#e8ecef"/>
    </g>
    <rect class="speed" x="-112" y="66" width="66" height="18" rx="6"/>
    <text class="speedtxt" x="-79" y="79">33</text>
  </div>

  <div class="info">
    <text class="title">Nightfall Drive</text>
    <text class="sub">Now spinning · side 1/3 · 33 rpm</text>
  </div>

  <div class="progress">
    <text class="clock">1:24</text>
    <rect class="track" x="46" y="-3" width="360" height="6" rx="3"/>
    <rect class="played" x="46" y="-3" width="118" height="6" rx="3"/>
    <rect class="buffered" x="164" y="-3" width="92" height="6" rx="3"/>
    <circle class="thumb" cx="164" cy="0" r="7"/>
    <text class="clock" x="420" y="0">3:47</text>
  </div>

  <div class="shelves">
    <g class="shelf">
      <text class="shelfhead">Record crate</text>
      ${sleeve(14, 34, 46, '#c2703f')}
      ${sleeve(68, 34, 46, '#4f6f9e')}
      ${sleeve(122, 34, 46, '#7a5a9c')}
      ${sleeve(176, 34, 46, '#3f7d6a')}
    </g>
    <g class="shelf fav">
      <text class="shelfhead">Favourites</text>
      ${sleeve(14, 34, 46, '#a8455c')}
      ${sleeve(68, 34, 46, '#8a6a3a')}
    </g>
  </div>
</div>`;

// The diagram uses its own stylesheet so the file stands alone.
const css = `
  .frame { fill: none; }
  .searchbar { }
  .platter { fill: #2f3237; }
  .disc { fill: #16161a; }
  .label { fill: #d9a441; }
  .hole { fill: #0b0b0d; }
  .armbase { fill: #c9ced3; }
  .tube { fill: #b7bcc2; }
  .head { fill: #2b2f33; }
  .knob circle { fill: #c9ced3; }
  .speed { fill: #2b2f33; }
  .speedtxt { fill: #cfd4d9; font: 700 9px ui-sans-serif, system-ui, sans-serif; text-anchor: middle; }
  .title { fill: #2b2118; font: 700 15px ui-sans-serif, system-ui, sans-serif; text-anchor: middle; }
  .sub { fill: #7a6f62; font: 11px ui-sans-serif, system-ui, sans-serif; text-anchor: middle; }
  .clock { fill: #7a6f62; font: 10px ui-monospace, monospace; }
  .clock:last-of-type { text-anchor: end; }
  .track { fill: #ddd6cb; }
  .played { fill: #b5762f; }
  .buffered { fill: #c9c0b2; }
  .thumb { fill: #fff; stroke: #b5762f; stroke-width: 3; }
  .shelfhead { fill: #6f6457; font: 700 11px ui-sans-serif, system-ui, sans-serif; }
`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="How the panel is arranged: the turntable in the centre, with the record crate and the favourites shelf underneath">
  <title>Panel layout</title>
  <desc>The vinyl player panel: a search field at the top, the turntable in the centre, the now-playing title and a progress bar below it, and two shelves at the bottom — the record crate and the favourites.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbf9f6"/>
      <stop offset="1" stop-color="#efeae2"/>
    </linearGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#7a5334"/>
      <stop offset="0.55" stop-color="#5a3a22"/>
      <stop offset="1" stop-color="#3c2614"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f2f5f7"/>
      <stop offset="0.5" stop-color="#b9c0c7"/>
      <stop offset="1" stop-color="#7d858d"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <style>${css}</style>
  </defs>

  <rect width="${W}" height="${H}" rx="18" fill="url(#bg)"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="17" fill="none" stroke="#000" stroke-opacity="0.07"/>

  <!-- search field -->
  <g transform="translate(40 30)">
    <rect width="${W - 80}" height="34" rx="17" fill="#fff" stroke="#d8d1c6"/>
    <circle cx="22" cy="17" r="5.5" fill="none" stroke="#a79c8d" stroke-width="2"/>
    <line x1="26" y1="21" x2="30" y2="25" stroke="#a79c8d" stroke-width="2" stroke-linecap="round"/>
    <text x="40" y="21" fill="#a79c8d" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12">Search Bilibili music…</text>
  </g>

  <!-- the deck: cabinet, platter, record, tonearm, hardware -->
  <g transform="translate(${W / 2} 232)">
    <rect x="-186" y="-124" width="372" height="248" rx="18" fill="url(#wood)" stroke="#241608" stroke-opacity="0.4"/>
    <rect x="-186" y="-124" width="372" height="36" rx="18" fill="#8a6340" opacity="0.45"/>
    <rect x="-186" y="-90" width="372" height="7" fill="url(#metal)" opacity="0.7"/>

    <circle cx="0" cy="0" r="82" fill="#1d2023" opacity="0.5"/>
    <circle cx="0" cy="0" r="80" fill="url(#metal)" opacity="0.85"/>
    <circle cx="0" cy="0" r="76" fill="#20242a"/>
    <circle cx="0" cy="0" r="72" fill="#131317"/>
    <circle cx="0" cy="0" r="72" fill="url(#sheen)"/>
    <circle cx="0" cy="0" r="66" fill="none" stroke="#3a3b42" stroke-opacity="0.5" stroke-width="0.8"/>
    <circle cx="0" cy="0" r="54" fill="none" stroke="#3a3b42" stroke-opacity="0.35" stroke-width="0.6"/>
    <circle cx="0" cy="0" r="41" fill="none" stroke="#3a3b42" stroke-opacity="0.3" stroke-width="0.5"/>
    <circle cx="0" cy="0" r="27" fill="#0d0e11"/>
    <circle cx="0" cy="0" r="24" fill="#d9a441"/>
    <circle cx="0" cy="0" r="24" fill="none" stroke="#8a5c28" stroke-opacity="0.55"/>
    <text x="0" y="4" fill="#6b4a1c" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" font-weight="700" text-anchor="middle">ND</text>
    <circle cx="0" cy="0" r="3.4" fill="#1a1a1d"/>

    <!-- tonearm, engaged over the record -->
    <g transform="rotate(26 0 0)">
      <circle cx="120" cy="0" r="17" fill="url(#metal)"/>
      <circle cx="120" cy="0" r="11" fill="#2e3236"/>
      <circle cx="120" cy="0" r="6" fill="url(#metal)"/>
      <rect x="118" y="-5" width="4" height="76" fill="#c3c9cf"/>
      <rect x="118" y="68" width="20" height="21" rx="5" fill="#22262a" stroke="#0d0f11"/>
    </g>

    <!-- hardware -->
    <rect x="-160" y="76" width="64" height="19" rx="7" fill="#2b2f33" stroke="#14171a"/>
    <text x="-128" y="89" fill="#e6eaee" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10" font-weight="700" text-anchor="middle">33</text>
    <circle cx="152" cy="88" r="14" fill="url(#metal)"/>
    <circle cx="152" cy="88" r="9" fill="#2a2e32"/>
    <rect x="150.6" y="81" width="2.8" height="7" rx="1.4" fill="#e8ecef"/>
  </g>

  <!-- now playing -->
  <text x="${W / 2}" y="392" fill="#2b2118" font-family="ui-sans-serif, system-ui, sans-serif" font-size="15" font-weight="700" text-anchor="middle">Nightfall Drive</text>
  <text x="${W / 2}" y="410" fill="#7a6f62" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" text-anchor="middle">Now spinning · side 1/3 · 33 rpm</text>

  <!-- progress: played, buffered, unloaded -->
  <g transform="translate(40 440)">
    <text y="4" fill="#7a6f62" font-family="ui-monospace, monospace" font-size="10">1:24</text>
    <rect x="38" y="0" width="${W - 116}" height="6" rx="3" fill="#ddd6cb"/>
    <rect x="38" y="0" width="132" height="6" rx="3" fill="#b5762f"/>
    <rect x="170" y="0" width="96" height="6" rx="3" fill="#c9c0b2"/>
    <circle cx="170" cy="3" r="7" fill="#fff" stroke="#b5762f" stroke-width="3"/>
    <text x="${W - 118}" y="4" fill="#7a6f62" font-family="ui-monospace, monospace" font-size="10" text-anchor="end">3:47</text>
  </g>

  <!-- the two shelves -->
  <g transform="translate(40 476)">
    <text fill="#6f6457" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" font-weight="700">Record crate</text>
    ${[0, 1, 2, 3].map((i) => sleeve(2 + i * 50, 10, 42, ['#c2703f', '#4f6f9e', '#7a5a9c', '#3f7d6a'][i])).join('')}
  </g>
  <g transform="translate(${W / 2 + 20} 476)">
    <text fill="#6f6457" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" font-weight="700">Favourites</text>
    ${[0, 1].map((i) => sleeve(2 + i * 50, 10, 42, ['#a8455c', '#8a6a3a'][i])).join('')}
  </g>
</svg>
`;

const outDir = path.join(here, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'diagram.svg');
fs.writeFileSync(outPath, svg.replace(/\n\s*\n\s*\n/g, '\n\n'), 'utf8');

const written = fs.readFileSync(outPath, 'utf8');
const checks = [
  ['valid XML declaration', written.startsWith('<?xml')],
  ['single svg root', (written.match(/<svg/g) ?? []).length === 1],
  ['declares the svg namespace', written.includes('xmlns="http://www.w3.org/2000/svg"')],
  ['declares width and height', /<svg[^>]*\swidth="\d+"/.test(written)],
  ['has a title', written.includes('<title>')],
  ['no wrapper div', !written.includes('<div')],
  ['shows the tonearm', written.includes('tonearm')],
  ['shows both shelves', written.includes('Record crate') && written.includes('Favourites')],
  ['shows the buffered band', written.includes('#c9c0b2')],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed += 1;
}
console.log(`\nwrote ${path.relative(process.cwd(), outPath)} — ${written.length} bytes, ${W}x${H}`);
console.log(`${checks.length - failed}/${checks.length} diagram checks passed`);
process.exit(failed === 0 ? 0 : 1);
