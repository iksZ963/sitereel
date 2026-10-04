import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

/** Bundled ffmpeg (ffmpeg-static) first, then a system ffmpeg. Returns null if neither exists. */
export async function findFfmpeg() {
  try {
    const mod = await import('ffmpeg-static');
    const p = mod.default;
    if (p && fs.existsSync(p)) return { path: p, source: 'bundled' };
  } catch {}
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
