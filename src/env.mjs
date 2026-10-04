import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);

function bundledPath() {
  try {
    const p = require('ffmpeg-static');
    return typeof p === 'string' ? p : null;
  } catch {
    return null;
  }
}

/**
 * Bundled ffmpeg (ffmpeg-static) first, then a system ffmpeg. Returns null if neither exists.
 * Newer npm versions skip dependency install scripts, which is how ffmpeg-static downloads its binary,
 * so with { install: true } we run that script ourselves the first time it is missing.
 */
export async function findFfmpeg({ install = false } = {}) {
  const p = bundledPath();
  if (p && !fs.existsSync(p) && install) {
    try {
      const dir = path.dirname(require.resolve('ffmpeg-static/package.json'));
      console.log('Downloading ffmpeg (one-time)...');
      spawnSync(process.execPath, [path.join(dir, 'install.js')], { cwd: dir, stdio: 'inherit' });
    } catch {}
  }
  if (p && fs.existsSync(p)) return { path: p, source: 'bundled' };
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return r.status === 0 ? { path: 'ffmpeg', source: 'system' } : null;
}

export function hasChromium() {
  try {
    const exe = chromium.executablePath();
    return !!exe && fs.existsSync(exe);
  } catch {
    return false;
  }
}

export function ensureChromium() {
  if (hasChromium()) return;
  console.log('Installing the Chromium browser (one-time, ~150 MB)...');
  const r = spawnSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('Could not install Chromium. Run:  npx playwright install chromium');
}
