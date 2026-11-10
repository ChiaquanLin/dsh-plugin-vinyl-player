/**
 * Keep the installation instructions and the package manifest in agreement.
 *
 * Documentation rots silently: a command in the README that no longer matches the
 * manifest looks fine until someone follows it. This suite pins the contract that
 * each documented install path depends on.
 *
 * All three paths were verified by hand against the real toolchain — `dsh plugin
 * add` with a GitHub spec installed the bundle into a scratch profile, and the
 * installed copy loaded its manifest and patch. These checks guard the properties
 * that made those commands work.
 */
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

const pkg = JSON.parse(read('package.json'));
const readme = read('README.md');
// The primary README is Chinese; an English translation sits beside it.
const readmeEn = fs.readFileSync(new URL('README.en.md', root), 'utf8');
const publishing = read('PUBLISHING.md');

const checks = [];
const check = (label, ok, detail) => {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : '  ' + detail}`);
};

// --- 1. the package can be installed from a registry ---------------------
check('the package is not private', pkg.private === undefined, String(pkg.private));
check('the package has a publishable name', typeof pkg.name === 'string' && pkg.name.startsWith('dsh-plugin-'), pkg.name);
check('the package declares a version', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version);
check('the package declares its licence', pkg.license === 'MIT', pkg.license);
// No registry release: publish metadata would imply a package to fetch.
check('the manifest carries no publish config', pkg.publishConfig === undefined, JSON.stringify(pkg.publishConfig));

// A repository field is what makes `npm install github:…` resolvable and what npm
// shows on the package page.
check('the repository field points at the real remote', /ChiaquanLin\/dsh-plugin-vinyl-player/.test(pkg.repository?.url ?? ''), pkg.repository?.url);

// --- 2. the bundle manifest is complete ---------------------------------
check('the bundle declares its patch', pkg.dsh?.bundle?.patch === './cordis.patch.yml', pkg.dsh?.bundle?.patch);
check('the bundle declares a web client', pkg.dsh?.client?.platform === 'web', pkg.dsh?.client?.platform);
check('the client declares its injections', Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.length >= 3, String(pkg.dsh?.client?.inject?.length));

// Every file the loader opens at runtime must actually ship.
const required = ['index.js', 'lib/client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json'];
for (const name of required) {
  let present = false;
  try {
    present = fs.existsSync(new URL(name, root));
  } catch {
    present = false;
  }
  check(`the package ships ${name}`, present);
}

// Every runtime file must exist on disk. There is no tarball filter any more, so
// a missing file is simply a broken install.
check('the package ships no tarball filter', pkg.files === undefined, JSON.stringify(pkg.files));

// --- 3. the README documents all three paths ---------------------------
check('the README has an install section', /^## 安装$/m.test(readme));

// --- language navigation ---------------------------------------------------
check('the primary README is Chinese', /^# 黑胶唱片机$/m.test(readme), /^# (.+)$/m.exec(readme)?.[1]);
check('it links to the English translation', /\[English\]\(README\.en\.md\)/.test(readme));
check('the English translation links back', /\[简体中文\]\(README\.md\)/.test(readmeEn));
check('Chinese is presented first', (() => {
  const i = readme.indexOf('简体中文');
  const j = readme.indexOf('[English]');
  return i !== -1 && j !== -1 && i < j;
})(), 'zh label precedes the en link');
check('the translation has the same section count', (() => {
  const zh = [...readme.matchAll(/^## (.+)$/gm)].length;
  const en = [...readmeEn.matchAll(/^## (.+)$/gm)].length;
  return zh > 0 && zh === en;
})(), 'each README has the same number of sections');
check('it documents asking an agent to install', /让智能体帮你装/.test(readme));
check('it shows the conversational command', /安装 https:\/\/github\.com\/ChiaquanLin\/dsh-plugin-vinyl-player/.test(readme));

// `--profile` is a required option on `dsh plugin`, and it must sit between
// `plugin` and the subcommand. A command without it fails with
// "required option '--profile <name>' not specified", which is exactly what a
// reader would hit.
check('every documented dsh plugin command names a profile', (() => {
  const commands = [...readme.matchAll(/dsh plugin ([^\n`]*)/g)].map((m) => m[1]);
  if (commands.length === 0) return false;
  return commands.every((rest) => /^--profile \S+/.test(rest));
})(), JSON.stringify([...readme.matchAll(/dsh plugin ([^\n`]*)/g)].map((m) => m[1].slice(0, 40))));

// The flag belongs before the subcommand; `add --profile` would be parsed as an
// argument to add.
check('the profile flag precedes the subcommand', !/dsh plugin add[^\n]*--profile/.test(readme));
check('it documents the GitHub spec', /github:ChiaquanLin\/dsh-plugin-vinyl-player/.test(readme));
// A registry install is not offered, so the README must not suggest one.
check('it does not promise a registry install', !/dsh plugin add dsh-plugin-vinyl-player(?!\S)/.test(readme), 'no bare package-name install');
check('it documents removing the plugin', /dsh plugin --profile \S+ remove/.test(readme));

// The old, wrong command must not reappear: `dsh plugin` forwards to pnpm, so there
// is no `install-bundle` verb.
check('it does not invent an install-bundle verb', !/dsh plugin install-bundle/.test(readme));

// --- 4. publishing notes match reality ---------------------------------
check('the publishing guide does not describe a registry release', !/npm publish/.test(publishing), 'npm publish');

// --- 5. the README's stated test count matches reality -----------------
// A number in the README goes stale quietly. Count the suites `test` actually runs
// and compare it with what the README claims.
const suiteCommands = (pkg.scripts?.test ?? '').split('&&').map((part) => part.trim()).filter(Boolean);
const suiteCount = suiteCommands.length;
const claimedSuites = /(\d+) 个套件/.exec(readme)?.[1];
check('the README states the suite count', claimedSuites !== undefined, `${claimedSuites} vs ${suiteCount}`);
check('the stated suite count matches package.json', Number(claimedSuites) === suiteCount, `README says ${claimedSuites}, test runs ${suiteCount}`);

// The check total in the README is maintained by tools/count-cycle.mjs, which
// runs the whole tree and rewrites it. Keeping that out of here avoids a suite
// that has to run itself to count itself.
check('the README states a check total', /\d+ 项检查/.test(readme), /(\d+) 项检查/.exec(readme)?.[1]);

// --- 6. metadata is present, without release-only fields ----------------
check('the package still has a description', typeof pkg.description === 'string' && pkg.description.length > 20);
check('the package points at its repository', /ChiaquanLin\/dsh-plugin-vinyl-player/.test(pkg.repository?.url ?? ''), pkg.repository?.url);
check('the package has zero runtime dependencies', Object.keys(pkg.dependencies ?? {}).length === 0, JSON.stringify(pkg.dependencies));
check('keywords carry the discoverability topic', (pkg.keywords ?? []).includes('dsh-plugin'), JSON.stringify(pkg.keywords?.slice(0, 3)));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} install-docs checks passed`);
process.exit(failed === 0 ? 0 : 1);
