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
check('publishing is explicitly public', pkg.publishConfig?.access === 'public', pkg.publishConfig?.access);

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

// `files` must cover those paths, or npm would leave them out of the tarball.
// A pattern ending in `/*` covers its whole directory; `*.ext` covers that
// extension anywhere in it.
const covers = (name) => (pkg.files ?? []).some((pattern) => {
  if (pattern === name) return true;
  const dirPrefix = pattern.endsWith('/*') ? pattern.slice(0, -1) : null;
  if (dirPrefix !== null) {
    if (name.startsWith(dirPrefix)) return true;
    // `tools/*.mjs` matches any .mjs directly inside tools/
    return false;
  }
  if (pattern.includes('*.')) {
    const [dir, ext] = pattern.split('*.');
    const suffix = `.${ext}`;
    if (!name.endsWith(suffix)) return false;
    // The wildcard covers the directory itself, not deeper paths.
    return name.startsWith(`${dir}`) && !name.slice(dir.length).includes('/');
  }
  return false;
});
for (const name of ['index.js', 'lib/client.js', 'cordis.patch.yml', 'locale/en.json']) {
  check(`the files field covers ${name}`, covers(name), JSON.stringify(pkg.files));
}

// The suites ship too: `npm test` is how a user checks an install.
check('the test suites ship with the package', covers('tools/layout-check.mjs'), JSON.stringify(pkg.files));

// --- 3. the README documents all three paths ---------------------------
check('the README has an Install section', /^## Install$/m.test(readme));
check('it documents asking an agent to install', /ask an agent to install/i.test(readme));
check('it shows the conversational command', /安装 https:\/\/github\.com\/ChiaquanLin\/dsh-plugin-vinyl-player/.test(readme));
check('it documents `dsh plugin add`', /dsh plugin add/.test(readme));
check('it documents the GitHub spec', /github:ChiaquanLin\/dsh-plugin-vinyl-player/.test(readme));
check('it documents the registry name', /dsh plugin add dsh-plugin-vinyl-player/.test(readme));
check('it documents removing the plugin', /dsh plugin remove/.test(readme));

// The old, wrong command must not reappear: `dsh plugin` forwards to pnpm, so there
// is no `install-bundle` verb.
check('it does not invent an install-bundle verb', !/dsh plugin install-bundle/.test(readme));

// --- 4. publishing notes match reality ---------------------------------
check('the publishing guide explains the npm path', /## Publishing to npm/.test(publishing), 'npm publish');
check('it uses the topics endpoint, not a repo PATCH', /\/topics/.test(publishing));
check('it no longer claims `gh repo edit` is the only route', /gh repo edit --add-topic.*does the same/.test(publishing) || !/^gh repo edit/m.test(publishing));

// A publish guard means a failing build cannot be released.
check('publishing runs the tests first', /npm test/.test(pkg.scripts?.prepublishOnly ?? ''), pkg.scripts?.prepublishOnly);

// --- 5. the README's stated test count matches reality -----------------
// A number in the README goes stale quietly. Count the suites `test` actually runs
// and compare it with what the README claims.
const suiteCommands = (pkg.scripts?.test ?? '').split('&&').map((part) => part.trim()).filter(Boolean);
const suiteCount = suiteCommands.length;
const claimedSuites = /(\d+) suites/.exec(readme)?.[1];
check('the README states the suite count', claimedSuites !== undefined, `${claimedSuites} vs ${suiteCount}`);
check('the stated suite count matches package.json', Number(claimedSuites) === suiteCount, `README says ${claimedSuites}, test runs ${suiteCount}`);

// The check total in the README is maintained by tools/count-cycle.mjs, which
// runs the whole tree and rewrites it. Keeping that out of here avoids a suite
// that has to run itself to count itself.
check('the README states a check total', /\d+ checks/.test(readme), /(\d+) checks/.exec(readme)?.[1]);

// --- 6. npm metadata is complete --------------------------------------
check('the author is an object with a name', typeof pkg.author === 'object' && typeof pkg.author.name === 'string', JSON.stringify(pkg.author));
check('a maintainer is declared', Array.isArray(pkg.maintainers) && pkg.maintainers.length > 0, JSON.stringify(pkg.maintainers));
check('the package has zero runtime dependencies', Object.keys(pkg.dependencies ?? {}).length === 0, JSON.stringify(pkg.dependencies));
check('keywords carry the discoverability topic', (pkg.keywords ?? []).includes('dsh-plugin'), JSON.stringify(pkg.keywords?.slice(0, 3)));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} install-docs checks passed`);
process.exit(failed === 0 ? 0 : 1);
