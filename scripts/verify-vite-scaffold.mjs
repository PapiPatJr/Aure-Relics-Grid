import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageJson = JSON.parse(read('package.json'));
const indexHtml = read('index.html');
const viteConfig = read('vite.config.js');
const mainJs = read('src/main.js');
const legacyBootstrap = read('src/app/legacyBootstrap.js');
const styleCss = read('style.css');

assert(packageJson.scripts.dev === 'vite --host 127.0.0.1', 'package.json must define the Vite dev script.');
assert(packageJson.scripts.build === 'vite build', 'package.json must define the Vite build script.');
assert(packageJson.scripts.preview === 'vite preview --host 127.0.0.1', 'package.json must define the Vite preview script.');
assert(Boolean(packageJson.devDependencies?.vite), 'package.json must include Vite as a dev dependency.');

assert(indexHtml.includes('<script src="script.js"></script>') || indexHtml.includes('<script type="module" src="/src/main.js"></script>'), 'index.html must keep a legacy script tag or load the Vite module entry.');
assert(viteConfig.includes('transformIndexHtml'), 'vite.config.js must bridge the legacy script tag into the Vite module entry.');
assert(viteConfig.includes('/src/main.js'), 'vite.config.js must point the Vite bridge at /src/main.js.');
assert(indexHtml.includes('href="style.css"'), 'index.html must keep the current stylesheet reference.');
assert(indexHtml.includes('./images/Logo-symbol.png'), 'index.html must keep the local symbol logo path.');
assert(indexHtml.includes('./images/Logo-banner.png'), 'index.html must keep the local banner logo path.');
assert(!indexHtml.includes('fonts.googleapis.com'), 'index.html must not call Google Fonts.');
assert(!indexHtml.includes('fonts.gstatic.com'), 'index.html must not call Google Fonts static assets.');

assert(mainJs.includes("./app/legacyBootstrap.js"), 'src/main.js must import the legacy bootstrap module.');
assert(legacyBootstrap.includes("../../script.js"), 'legacyBootstrap.js must boot the existing root script.js file.');
assert(legacyBootstrap.includes('aureRelicsRuntime'), 'legacyBootstrap.js must mark the Vite runtime for debugging.');

assert(!styleCss.includes('@import url('), 'style.css must not import remote stylesheets.');
assert(!styleCss.includes('fonts.googleapis.com'), 'style.css must not call Google Fonts.');
assert(!styleCss.includes('fonts.gstatic.com'), 'style.css must not call Google Fonts static assets.');

for (const expectedPath of [
  'script.js',
  'style.css',
  'images/Logo-symbol.png',
  'images/Logo-banner.png',
  'fonts/Cinzel-VariableFont_wght.ttf',
  'fonts/Spectral-Regular.ttf',
  'fonts/Spectral-SemiBold.ttf',
  'fonts/Spectral-Bold.ttf',
  'docs/superpowers/specs/2026-09-14-aure-relics-v09-design.md',
  'docs/superpowers/plans/2026-09-14-aure-relics-v09-work-packages.md',
  'docs/superpowers/prompts/2026-09-14-aure-relics-v09-codex-start.md',
  'docs/testing/v09-test-strategy.md',
  'docs/testing/v09-test-checklist.md'
]) {
  assert(exists(expectedPath), `Expected scaffold dependency to exist: ${expectedPath}`);
}

console.log('Aure Relics Vite scaffold checks passed.');
