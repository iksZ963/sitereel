# sitereel

**Record a polished demo video of any website with one command.** No screen recorder, no clicking around, no re-takes.

```bash
npx sitereel
```

Demo videos are tedious: you record, fumble a click, scroll too fast, and start over every time the design changes. sitereel replays the same smooth, repeatable tour whenever you run it, in desktop and mobile sizes, so your demo is always up to date.

It builds and serves your project, opens a real browser, tours the site with smooth scrolling and a visible cursor with click ripples, fills in forms, and saves an `.mp4` and a `.webm` (ffmpeg is bundled). A progress bar shows what it's doing, and every step has a time limit so it can never hang silently.

## Install

```bash
npm install -D sitereel      # in your project
```

Chromium is downloaded automatically on the first run.

## Use

```bash
npx sitereel                 # desktop 1920x1080 -> demo-video/demo-desktop.webm/.mp4
npx sitereel --mobile        # phone 390x844
npx sitereel --both          # one build, both videos
npx sitereel --url http://localhost:3000    # record a site that's already running
npx sitereel preview         # watch the tour in a visible browser, nothing is recorded
npx sitereel doctor          # check that your setup is ready
```

Optional: add `"demo": "sitereel"` to your `package.json` scripts and run `npm run demo`.

## What it does by default

1. Detects the project: Next.js, Vite / Astro / SvelteKit, Create React App, or plain static HTML (a folder with `index.html`).
2. Builds and serves it on `127.0.0.1:3100`.
3. Home page: lingers a few seconds (so hero sliders play), then scrolls the whole page.
4. Auto-discovers up to 6 pages (nav links first, then `sitemap.xml`), skipping any that return an error.
5. Fills the first form it finds on each page with sample data. It does **not** submit unless you pass `--submit`.
6. Tidies each page first: dismisses cookie banners, hides the Next.js dev overlay and common chat widgets, and waits for fonts and images so nothing pops in mid-shot.

## Options

| Flag | Meaning |
| --- | --- |
| `--url <url>` | Record an already-running site (skips build + server) |
| `--device desktop\|mobile\|both` | Default `desktop` (`--mobile`, `--both` are shortcuts) |
| `--pages /a,/b` | Visit exactly these pages instead of auto-discovering |
| `--max-pages <n>` | Cap for auto-discovery (default 6) |
| `--out <dir>` | Output folder (default `demo-video`) |
| `--no-build` | Reuse the existing build |
| `--no-mp4` | Skip the ffmpeg step |
| `--no-forms` | Don't fill forms |
| `--submit` | Also submit the forms it fills |
| `--config <file>` | Config path |

## Config

`npx sitereel init` creates `sitereel.config.mjs`. Everything is optional.

```js
export default {
  pages: ['/about', '/pricing', '/contact'],
  server: { build: 'npm run build', start: 'npm start -- -p {port}', port: 3100 }, // custom stack
  // server: { static: 'dist' },                                                  // or a built folder
  homeDwell: 6500,
  hide: ['.promo-bar'], // extra elements to hide while recording
  // tidy: false,      // turn off banner dismissal and overlay hiding
  submitForms: true, // only for sites with a fake or safe backend
};
```

### Custom tour

Replace the automatic tour with your own script:

```js
export default {
  flow: async ({ page, base, mobile, helpers, progress }) => {
    const { click, type, scrollThrough, sleep } = helpers;
    await sleep(5000);
    await scrollThrough();
    await click('header >> text=Pricing');
    await scrollThrough({ screens: 3 });
    await type('input[name="email"]', 'hello@example.com');
    progress.set(1);
  },
};
```

Helpers: `sleep`, `smoothScroll(px)`, `scrollThrough({ screens, pause })`, `scrollToTop()`, `glide(target)`, `click(target)`, `type(target, text)`. A target is a selector string or a Playwright locator. The cursor glides to it first on desktop.

## Good to know

- **Next.js + `next dev`:** building while the dev server is running can clash over `.next`. Stop the dev server, or record it with `--url http://localhost:3000`. If your `next.config.js` has `distDir: process.env.NEXT_DIST_DIR || '.next'`, sitereel builds into `.next-demo` and never clashes.
- **Video quality:** Playwright's recorder compresses fairly hard. Fine for demos; it won't be pixel-perfect.
- **Images from the internet** (CDNs, Unsplash) need a connection while recording.
- **ffmpeg** is bundled (via `ffmpeg-static`) and downloaded automatically the first time you record, even if your npm blocks dependency install scripts. If that download fails, sitereel uses a system ffmpeg when there is one; otherwise you still get the `.webm`. `sitereel doctor` tells you which.
- **Requires** Node 18+.
