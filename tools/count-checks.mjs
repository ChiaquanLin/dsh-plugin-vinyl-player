/**
 * Run every suite once, count the checks, and update the figure in the README.
 *
 * The README quotes a check total, and a number written by hand goes stale the
 * moment a suite grows. This is the one place that number is computed, and it is
 * deliberately separate from the suites themselves: a suite that ran itself to
 * count itself would need a hardcoded result for its own contribution, which is
 * exactly the drift being prevented.
 *
 * Usage:
 *   node tools/count-checks.mjs           # report the totals
 *   node tools/count-checks.mjs --write   # also rewrite the README figure
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const write = process.argv.includes('--write');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
/** Every command `npm test` runs, in order. */
const suites = (pkg.scripts?.test ?? '')
  .split('&&')
  .map((part) => part.trim())
  .filter(Boolean)
  .map((command) => command.replace(/^node\s+/, ''));

let total = 0;
const rows = [];
for (const script of suites) {
  let passed = 0;
  let all = 0;
  try {
    const stdout = execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Each suite ends with a "N/M … checks passed" line, but the wording varies:
    // some name the suite ("10/10 artifact checks passed"), some do not
    // ("70/70 checks passed"). Take the last such line and read its two numbers.
    const totals = [...stdout.matchAll(/(\d+)\/(\d+)[^\n]*checks passed/gi)];
    const last = totals.at(-1);
    if (last !== undefined) {
      passed = Number(last[1]);
      all = Number(last[2]);
    }
  } catch (error) {
    rows.push({ script, passed: 0, all: 0, failed: true });
    continue;
  }
  total += all;
  rows.push({ script, passed, all, failed: passed !== all });
}

const width = Math.max(...rows.map((row) => row.script.length));
for (const row of rows) {
  const name = path.basename(row.script).padEnd(width);
  const state = row.failed ? 'FAIL' : 'ok';
  console.log(`${name}  ${String(row.passed).padStart(3)}/${String(row.all).padEnd(3)}  ${state}`);
}

const failing = rows.filter((row) => row.failed);
console.log(`\n${rows.length} suites, ${total} checks${failing.length ? `, ${failing.length} failing` : ', all passing'}`);

if (write) {
  // Both translations quote the totals. Update each in its own phrasing so neither
  // can drift, and report per file.
  const targets = [
    { file: 'README.md', patterns: [[/\d+ 个套件\s*\/\s*\d+ 项检查/g, `${rows.length} 个套件 / ${total} 项检查`]] },
    { file: 'README.en.md', patterns: [[/\d+ suites\s*\/\s*\d+ checks/g, `${rows.length} suites / ${total} checks`]] },
  ];
  for (const { file, patterns } of targets) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) continue;
    const before = fs.readFileSync(target, 'utf8');
    let after = before;
    for (const [pattern, replacement] of patterns) after = after.replace(pattern, replacement);
    if (after === before) {
      console.log(`${file}: already up to date`);
    } else {
      fs.writeFileSync(target, after, 'utf8');
      console.log(`${file}: updated to ${rows.length} suites / ${total} checks`);
    }
  }
}

process.exit(failing.length === 0 ? 0 : 1);
