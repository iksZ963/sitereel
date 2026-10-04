import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function killTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else proc.kill('SIGKILL');
  } catch {}
}

export async function isUp(url, ms = 1500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function waitFor(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await isUp(url, 3000)) return;
    await sleep(400);
  }
  throw new Error(`Nothing responded at ${url} after ${Math.round(timeoutMs / 1000)}s.`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Work out how to build and serve the project in `cwd`. */
export function detectPlan(cwd, cfg = {}) {
  const s = cfg.server || {};
  const port = s.port || 3100;
  const sub = (c) => (c ? c.replaceAll('{port}', String(port)) : c);
  const pkg = readJson(path.join(cwd, 'package.json')) || {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const build = pkg.scripts?.build ? 'npm run build' : null;
  const hasIndex = (dir) => fs.existsSync(path.join(cwd, dir, 'index.html'));

  if (s.static) return { label: 'static folder', staticDir: s.static, build: sub(s.build) ?? null, port };
  if (s.start) return { label: 'custom', build: sub(s.build) ?? build, start: sub(s.start), port };
  if (deps.next)
    return { label: 'Next.js', build, start: `npm run start -- -p ${port} -H 127.0.0.1`, port };
  if (deps.vite || deps.astro || deps['@sveltejs/kit'])
    return { label: 'Vite-style', build, start: `npm run preview -- --port ${port} --host 127.0.0.1`, port };
  if (deps['react-scripts']) return { label: 'Create React App', build, staticDir: 'build', port };
  if (hasIndex('.')) return { label: 'static site', staticDir: '.', build: null, port };
  for (const d of ['dist', 'build', 'out', 'public'])
    if (hasIndex(d)) return { label: `static (${d}/)`, staticDir: d, build: null, port };

  throw new Error(
    'Could not work out how to serve this project.\n' +
      'Run it yourself and pass --url, e.g.  sitereel --url http://localhost:3000\n' +
      'or set "server" in sitereel.config.mjs (see README).'
  );
}

export function runBuild(command, cwd, env, onLine) {
  const tail = [];
  const proc = spawn(command, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'], // no stdin, so an interactive prompt can never block the build
    env: { ...process.env, ...env },
  });
  const onData = (buf) => {
    for (const l of buf.toString().split(/\r?\n/)) {
      const t = l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
      if (!t) continue;
      tail.push(t);
      if (tail.length > 40) tail.shift();
      onLine?.(t.slice(0, 40));
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  const done = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Build failed (exit ${code}). Last output:\n${tail.join('\n')}`))
    );
  });
  return { proc, done };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

function serveStatic(dir, port) {
  const root = path.resolve(dir);
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(root, p);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    const isFile = (f) => fs.existsSync(f) && fs.statSync(f).isFile();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!isFile(file) && isFile(file + '.html')) file += '.html';
    if (!isFile(file)) file = path.join(root, 'index.html'); // SPA fallback
    if (!isFile(file)) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve({ close: async () => srv.close() }));
  });
}

export async function startServer(plan, cwd, env) {
  if (plan.staticDir) return serveStatic(path.resolve(cwd, plan.staticDir), plan.port);
  const proc = spawn(plan.start, { cwd, shell: true, stdio: 'ignore', env: { ...process.env, ...env } });
  return { proc, close: async () => killTree(proc) };
}
