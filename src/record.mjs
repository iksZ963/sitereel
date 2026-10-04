import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createProgress } from './progress.mjs';
import { detectPlan, runBuild, startServer, waitFor, isUp, killTree } from './server.mjs';
import {
  makeHelpers, installCursor, installTidy, prepare, discoverPages, fillForms, isOk, sleep,
} from './actions.mjs';
import { ensureChromium, findFfmpeg } from './env.mjs';

export const DEFAULTS = {
  url: undefined, // record an already-running site (skips build + server)
  device: 'desktop', // desktop | mobile | both
  viewport: { width: 1920, height: 1080 },
  mobileViewport: { width: 390, height: 844 },
  pages: undefined, // e.g. ['/about', '/contact']; auto-discovered when omitted
  maxPages: 6,
  screensPerPage: 4,
  homeDwell: 5000, // ms to linger on the home page before scrolling (lets hero sliders play)
  fillForms: true,
  submitForms: false, // off by default so a demo never posts to a real backend
  tidy: true, // dismiss cookie banners, hide dev overlays / chat widgets
  hide: [], // extra CSS selectors to hide while recording
  preview: false, // watch the tour in a visible browser, record nothing
  flow: undefined, // async ({ page, base, device, mobile, viewport, helpers, progress }) => {} replaces the default tour
  out: 'demo-video',
  mp4: true,
  noBuild: false,
  buildTimeout: 420, // seconds
  server: {}, // { build, start, static, port }, {port} is substituted in commands
};

const encode = (bin, args) =>
  new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });

export async function record(userOpts = {}) {
  const cfg = { ...DEFAULTS, ...userOpts, server: { ...DEFAULTS.server, ...userOpts.server } };
  const cwd = process.cwd();
  const state = { progress: null, browser: null, build: null, server: null, failing: false };

  const fail = async (message) => {
    if (state.failing) return;
    state.failing = true;
    state.progress?.end();
    console.error(`\nFAILED: ${message}`);
    try {
      await state.browser?.close();
    } catch {}
    killTree(state.build?.proc);
    await state.server?.close();
    process.exit(1);
  };
  process.on('SIGINT', () => fail('Cancelled (Ctrl+C).'));
  process.on('SIGTERM', () => fail('Terminated.'));

  async function pass(device, base) {
    const mobile = device === 'mobile';
    const viewport = cfg.preview && !mobile ? { width: 1280, height: 720 } : mobile ? cfg.mobileViewport : cfg.viewport;
    const progress = (state.progress = createProgress(
      [
        { id: 'browser', label: 'Launching browser', weight: 3, limit: 120 },
        { id: 'pages', label: `${cfg.preview ? 'Previewing' : 'Recording'} ${device}`, weight: 87, limit: 1200 },
        { id: 'save', label: cfg.preview ? 'Finishing' : 'Saving video', weight: 10, limit: 300, auto: 20000 },
      ],
      { onTimeout: fail }
    ));

    progress.start('browser');
    if (!cfg.preview) fs.mkdirSync(cfg.out, { recursive: true });
    const browser = (state.browser = await chromium.launch({ headless: !cfg.preview }));
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      ...(cfg.preview ? {} : { recordVideo: { dir: cfg.out, size: viewport } }),
      ...(mobile ? { isMobile: true, hasTouch: true } : {}),
    });
    context.setDefaultTimeout(30000);
    context.setDefaultNavigationTimeout(45000);
    if (!mobile) await installCursor(context);
    if (cfg.tidy) await installTidy(context, cfg.hide);
    const page = await context.newPage();
    const video = cfg.preview ? null : page.video();
    const h = makeHelpers(page, { mobile, viewport });
    const tidy = async () => {
      if (cfg.tidy) await prepare(page);
    };

    progress.start('pages');
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await tidy();

    if (cfg.flow) {
      await cfg.flow({ page, base, device, mobile, viewport, helpers: h, progress });
    } else {
      const routes = cfg.pages ? cfg.pages.filter((p) => p !== '/') : await discoverPages(page, base, cfg.maxPages);
      const units = [1.5, ...routes.map(() => 1)];
      const totalUnits = units.reduce((a, b) => a + b, 0);
      const mark = (i, f, d) => progress.set((units.slice(0, i).reduce((a, b) => a + b, 0) + units[i] * f) / totalUnits, d);
      const forms = async () => {
        if (cfg.fillForms) await fillForms(page, h, { submit: cfg.submitForms });
      };

      mark(0, 0.02, '/');
      await sleep(cfg.homeDwell);
      await h.scrollThrough({ pause: 1000, onProgress: (p) => mark(0, p, '/') });
      await forms().catch(() => {});
      await h.scrollToTop();

      for (let i = 0; i < routes.length; i++) {
        const route = routes[i];
        try {
          if (!(await isOk(page, base + route))) {
            progress.log(`Skipped ${route}: page returned an error status.`);
            mark(i + 1, 1);
            continue;
          }
          await page.goto(base + route, { waitUntil: 'load' });
          await tidy();
          await sleep(1200);
          await h.scrollThrough({ screens: cfg.screensPerPage, pause: 800, onProgress: (p) => mark(i + 1, p, route) });
          await forms().catch(() => {});
        } catch (e) {
          progress.log(`Skipped ${route}: ${String(e.message).split('\n')[0]}`);
        }
      }
    }

    progress.start('save');
    if (cfg.preview) await sleep(2000);
    await context.close(); // finalises the video file
    await browser.close();
    state.browser = null;

    if (cfg.preview) {
      const elapsed = progress.elapsed();
      progress.end();
      console.log(`[${'#'.repeat(28)}] 100%  ${device} preview finished in ${elapsed} (nothing was recorded)`);
      return [];
    }

    progress.set(0.2, 'writing .webm');
    const webm = path.join(cfg.out, `demo-${device}.webm`);
    fs.renameSync(await video.path(), webm);
    const files = [webm];

    if (cfg.mp4) {
      progress.set(0.3, 'encoding .mp4');
      const ff = await findFfmpeg();
      if (ff) {
        const mp4 = path.join(cfg.out, `demo-${device}.mp4`);
        const ok = await encode(ff.path, [
          '-y', '-i', webm, '-c:v', 'libx264', '-crf', '16', '-preset', 'medium',
          '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4,
        ]);
        if (ok) files.push(mp4);
        else progress.log('ffmpeg could not encode the .mp4; the .webm is still saved.');
      } else {
        progress.log('ffmpeg not found, so only .webm was created. Run `sitereel doctor` for help.');
      }
    }
    const elapsed = progress.elapsed();
    progress.end();
    console.log(`[${'#'.repeat(28)}] 100%  ${device} done in ${elapsed}`);
    return files;
  }

  try {
    console.log('sitereel: press Ctrl+C to cancel.\n');
    ensureChromium();

    let base = cfg.url;
    if (base) {
      try {
        await waitFor(base, 15000);
      } catch {
        throw new Error(`Nothing is responding at ${base}. Start your site first, or drop --url so sitereel builds and serves it.`);
      }
    } else {
      const plan = detectPlan(cwd, cfg);
      base = `http://127.0.0.1:${plan.port}`;
      if (plan.label === 'Next.js' && (await isUp('http://127.0.0.1:3000'))) {
        console.log(
          'Note: something is already running on :3000. If that is `next dev`, building at the same time can clash.\n' +
            '      Stop it, or record it directly with:  sitereel --url http://localhost:3000\n'
        );
      }
      const doBuild = plan.build && !cfg.noBuild;
      const phases = [];
      if (doBuild) phases.push({ id: 'build', label: `Building (${plan.label})`, weight: 75, limit: cfg.buildTimeout, auto: 60000 });
      phases.push({ id: 'server', label: 'Starting server', weight: 25, limit: 90 });
      const pr = (state.progress = createProgress(phases, { onTimeout: fail }));
      const env = { NEXT_DIST_DIR: '.next-demo', NEXT_TELEMETRY_DISABLED: '1' };

      if (doBuild) {
        pr.start('build');
        state.build = runBuild(plan.build, cwd, env, (line) => pr.set(undefined, line));
        await state.build.done;
      }
      pr.start('server');
      state.server = await startServer(plan, cwd, env);
      await waitFor(base, 80000);
      pr.end();
    }

    const devices = cfg.device === 'both' ? ['desktop', 'mobile'] : [cfg.device];
    const saved = [];
    for (const d of devices) saved.push(...(await pass(d, base)));

    await state.server?.close();
    if (saved.length) {
      console.log('\nSaved:');
      saved.forEach((f) => console.log('  ' + path.resolve(f)));
    }
    process.exit(0);
  } catch (e) {
    await fail(e?.message || String(e));
  }
}
