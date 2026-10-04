#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

const HELP = `sitereel ${version}: record a demo video of any website, hands-free.

Usage
  sitereel [options]          record (builds + serves the project in the current folder)
  sitereel preview            watch the tour in a visible browser, nothing is recorded
  sitereel doctor             check that your setup is ready
  sitereel init               create a sitereel.config.mjs

Options
  --url <url>        record a site that is already running (skips build + server)
  --device <name>    desktop | mobile | both        (default: desktop)
  --mobile, --both   shortcuts for --device
  --pages /a,/b      pages to visit             (default: auto-discovered from the nav)
  --max-pages <n>    cap for auto-discovery         (default: 6)
  --out <dir>        output folder                  (default: demo-video)
  --no-build         reuse the existing build
  --no-mp4           keep only the .webm
  --no-forms         don't auto-fill forms
  --submit           also submit the forms it fills (off by default)
  --config <file>    config file (default: sitereel.config.mjs / .js / .json)
  -v, --version      -h, --help
`;

const TEMPLATE = `// sitereel.config.mjs, every field is optional
export default {
  // url: 'http://localhost:3000',   // record an already-running site instead of building one
  // server: { build: 'npm run build', start: 'npm start -- -p {port}', port: 3100 },
  // server: { static: 'dist' },     // or serve a built folder
  // pages: ['/about', '/pricing', '/contact'],
  maxPages: 6,
  screensPerPage: 4,
  // hide: ['.promo-bar'],          // extra elements to hide while recording
  // tidy: false,                    // don't dismiss cookie banners / hide dev overlays
  homeDwell: 5000,
  fillForms: true,
  submitForms: false,

  // Replace the automatic tour with your own script:
  // flow: async ({ page, base, mobile, helpers, progress }) => {
  //   const { click, type, scrollThrough, sleep } = helpers;
  //   await sleep(3000);
  //   await scrollThrough();
  //   await click('text=Pricing');
  //   await scrollThrough({ screens: 3 });
  //   progress.set(1);
  // },
};
`;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const argv = process.argv.slice(2);
const opts = {};
let cmd = 'record';
let configPath;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => {
    const v = argv[++i];
    if (v === undefined) die(`Missing value for ${a}`);
    return v;
  };
  switch (a) {
    case 'init': cmd = 'init'; break;
    case 'doctor': cmd = 'doctor'; break;
    case 'preview': opts.preview = true; break;
    case 'record': break;
    case '--url': opts.url = val(); break;
    case '--device': opts.device = val(); break;
    case '--mobile': opts.device = 'mobile'; break;
    case '--both': opts.device = 'both'; break;
    case '--pages': opts.pages = val().split(',').map((s) => s.trim()).filter(Boolean); break;
    case '--max-pages': opts.maxPages = Number(val()); break;
    case '--out': opts.out = val(); break;
    case '--config': configPath = val(); break;
    case '--no-build': opts.noBuild = true; break;
    case '--no-mp4': opts.mp4 = false; break;
    case '--no-forms': opts.fillForms = false; break;
    case '--submit': opts.submitForms = true; break;
    case '-v': case '--version': console.log(version); process.exit(0); break;
    case '-h': case '--help': console.log(HELP); process.exit(0); break;
    default: die(`Unknown option: ${a}\n\n${HELP}`);
  }
}

if (cmd === 'init') {
  const file = path.resolve('sitereel.config.mjs');
  if (fs.existsSync(file)) die('sitereel.config.mjs already exists.');
  fs.writeFileSync(file, TEMPLATE);
  console.log('Created sitereel.config.mjs');
  process.exit(0);
}

async function loadConfig() {
  const candidates = configPath
    ? [path.resolve(configPath)]
    : ['sitereel.config.mjs', 'sitereel.config.js', 'sitereel.config.json'].map((f) => path.resolve(f));
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) {
    if (configPath) die(`Config not found: ${configPath}`);
    return {};
  }
  if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
  return (await import(pathToFileURL(file).href)).default || {};
}

const config = await loadConfig();

if (cmd === 'doctor') {
  const { doctor } = await import('../src/doctor.mjs');
  process.exit((await doctor({ ...config, ...opts })) ? 0 : 1);
}
const { record } = await import('../src/index.mjs');
await record({ ...config, ...opts, server: { ...config.server } });
