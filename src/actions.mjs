export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- cursor + click ripples (Playwright videos don't capture the pointer) ----------
export async function installCursor(context) {
  await context.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div');
      c.style.cssText =
        'position:fixed;top:0;left:0;width:22px;height:22px;border-radius:50%;background:rgba(245,158,11,.9);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px);transition:transform 60ms linear';
      document.documentElement.appendChild(c);
      window.addEventListener('mousemove', (e) => {
        c.style.transform = `translate(${e.clientX - 11}px,${e.clientY - 11}px)`;
      }, true);
      window.addEventListener('mousedown', (e) => {
        const r = document.createElement('div');
        r.style.cssText =
          `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;border:3px solid rgba(245,158,11,.95);pointer-events:none;z-index:2147483646;transform:scale(.3);opacity:1;transition:transform 500ms ease-out,opacity 500ms ease-out`;
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => {
          r.style.transform = 'scale(1.7)';
          r.style.opacity = '0';
        });
        setTimeout(() => r.remove(), 600);
      }, true);
    });
  });
}

// ---------- tidy-up: hide dev overlays / chat widgets, dismiss cookie banners, wait for assets ----------
const DEFAULT_HIDE = [
  'nextjs-portal',
  '#__next-build-watcher',
  '[data-nextjs-toast]',
  '[data-nextjs-dev-tools-button]',
  '#intercom-container',
  '.intercom-lightweight-app',
  '#hubspot-messages-iframe-container',
  '#drift-widget-container',
  '#crisp-chatbox',
  '.tawk-min-container',
];

export async function installTidy(context, extraHide = []) {
  const sels = [...DEFAULT_HIDE, ...extraHide];
  await context.addInitScript(({ sels }) => {
    const add = () => {
      const s = document.createElement('style');
      s.textContent = sels.join(',') + '{display:none!important}';
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
    else add();
  }, { sels });
}

const ACCEPT = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|i agree|agree( and close)?|got it|ok(ay)?|accept & close)$/i;

export async function dismissBanners(page) {
  try {
    const btn = page
      .locator('[id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [aria-label*="cookie" i], [role="dialog"]')
      .getByRole('button', { name: ACCEPT })
      .first();
    const shown = await btn.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false);
    if (shown) {
      await btn.click({ timeout: 2000 });
      await sleep(600);
    }
  } catch {}
}

/** Wait for web fonts and for images that are currently in view (lazy images further down are ignored). */
export async function settle(page, timeout = 6000) {
  await page
    .evaluate(async (timeout) => {
      const inView = (img) => {
        const r = img.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight;
      };
      const pending = [...document.images]
        .filter((i) => !i.complete && inView(i))
        .map((i) => new Promise((res) => {
          i.addEventListener('load', res, { once: true });
          i.addEventListener('error', res, { once: true });
        }));
      await Promise.race([
        Promise.all([document.fonts ? document.fonts.ready : null, ...pending]),
        new Promise((r) => setTimeout(r, timeout)),
      ]);
    }, timeout)
    .catch(() => {});
  await sleep(300);
}

/** Run after every navigation. */
export async function prepare(page) {
  await settle(page);
  await dismissBanners(page);
}

// ---------- helpers handed to every flow, including custom `flow` functions ----------
export function makeHelpers(page, { mobile, viewport }) {
  const loc = (t) => (typeof t === 'string' ? page.locator(t) : t);

  const smoothScroll = (distance, duration = 1700) =>
    page.evaluate(
      ({ distance, duration }) =>
        new Promise((resolve) => {
          const start = window.scrollY;
          const t0 = performance.now();
          const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
          const tick = () => {
            const t = Math.min((performance.now() - t0) / duration, 1);
            window.scrollTo({ top: start + distance * ease(t), behavior: 'instant' });
            if (t < 1) setTimeout(tick, 16);
            else resolve();
          };
          tick();
        }),
      { distance, duration }
    );

  const scrollThrough = async ({ screens = 99, pause = 900, duration = 1700, onProgress } = {}) => {
    for (let i = 0; i < screens; i++) {
      const { y, h, total } = await page.evaluate(() => ({
        y: window.scrollY,
        h: window.innerHeight,
        total: document.documentElement.scrollHeight,
      }));
      onProgress?.(Math.min(1, (y + h) / total));
      if (y + h >= total - 4) break;
      await smoothScroll(Math.round(viewport.height * 0.75), duration);
      await settle(page, 2500); // let images that just came into view finish loading
      await sleep(pause);
    }
    onProgress?.(1);
  };

  const scrollToTop = async () => {
    const y = await page.evaluate(() => window.scrollY);
    if (y > 0) await smoothScroll(-y, 1800);
    await sleep(400);
  };

  const glide = async (target) => {
    const el = loc(target);
    await el.scrollIntoViewIfNeeded({ timeout: 15000 });
    if (mobile) return;
    const box = await el.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 35 });
    await sleep(250);
  };

  const click = async (target) => {
    const el = loc(target);
    await glide(el);
    await sleep(200);
    await el.click({ timeout: 15000 });
  };

  const type = async (target, text, delay = 55) => {
    const el = loc(target);
    await glide(el);
    await el.click({ timeout: 15000 });
    await el.pressSequentially(text, { delay });
    await sleep(250);
  };

  return { sleep, smoothScroll, scrollThrough, scrollToTop, glide, click, type, prepare: () => prepare(page) };
}

// ---------- page discovery ----------
/** True unless the URL answers with a 4xx/5xx. Network errors count as OK (goto will report them). */
export async function isOk(page, url) {
  try {
    const r = await page.request.get(url, { timeout: 8000, failOnStatusCode: false });
    return r.status() < 400;
  } catch {
    return true;
  }
}

/**
 * Pick pages to tour: nav links first, then other links, footer links, then sitemap.xml entries.
 * At most 2 per top-level section, no files, and only pages that actually load.
 */
export async function discoverPages(page, base, max) {
  const origin = new URL(base).origin;
  const found = [];

  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => ({
      href: a.href,
      rank: a.closest('nav, header') ? 0 : a.closest('footer') ? 2 : 1,
    }))
  );
  for (const { href, rank } of links) {
    try {
      const u = new URL(href);
      if (u.origin === origin) found.push({ path: u.pathname, rank });
    } catch {}
  }

  try {
    const res = await page.request.get(origin + '/sitemap.xml', { timeout: 4000, failOnStatusCode: false });
    if (res.ok()) {
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        try {
          const u = new URL(m[1]);
          if (!/\.xml$/i.test(u.pathname)) found.push({ path: u.pathname, rank: 3 }); // sitemap host may be the production domain
        } catch {}
      }
    }
  } catch {}

  const seen = new Set(['/']);
  const perSection = {};
  const out = [];
  let checks = 0;
  const ordered = found.map((f, i) => ({ ...f, i })).sort((a, b) => a.rank - b.rank || a.i - b.i);
  for (const { path: raw } of ordered) {
    if (out.length >= max || checks >= max * 4) break;
    const p = raw.replace(/\/+$/, '') || '/';
    if (seen.has(p) || /\.\w{2,5}$/.test(p)) continue;
    seen.add(p);
    const section = p.split('/')[1];
    if ((perSection[section] || 0) >= 2) continue;
    checks++;
    if (!(await isOk(page, origin + p))) continue;
    perSection[section] = (perSection[section] || 0) + 1;
    out.push(p);
  }
  return out;
}

// ---------- forms ----------
const SKIP_TYPES = new Set([
  'hidden', 'checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'password',
  'image', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range', 'search',
]);

function sampleFor({ tag, type, key }) {
  if (type === 'email' || /e-?mail/.test(key)) return 'alex.morgan@example.com';
  if (type === 'tel' || /phone|mobile|whatsapp|\btel\b/.test(key)) return '+1 555 0142';
  if (type === 'url') return 'https://example.com';
  if (type === 'number') return '3';
  if (tag === 'textarea' || /message|comment|detail|question|note|describe/.test(key))
    return "Hi! I'd love to learn more and see how you can help.";
  if (/first/.test(key)) return 'Alex';
  if (/last|surname/.test(key)) return 'Morgan';
  if (/name/.test(key)) return 'Alex Morgan';
  if (/company|organi[sz]ation/.test(key)) return 'Acme Inc.';
  if (/subject|title/.test(key)) return 'Quick question';
  return 'Sample text';
}

/** Fill the first visible form that has 2+ fillable fields. Submits only when asked to. */
export async function fillForms(page, h, { submit = false } = {}) {
  const forms = page.locator('form:visible');
  const count = await forms.count();
  for (let f = 0; f < count; f++) {
    const form = forms.nth(f);
    const fields = form.locator('input:visible, textarea:visible, select:visible');
    const n = await fields.count();
    const todo = [];
    for (let i = 0; i < n; i++) {
      const info = await fields.nth(i).evaluate((e) => ({
        tag: e.tagName.toLowerCase(),
        type: (e.type || '').toLowerCase(),
        key: [e.name, e.id, e.placeholder, e.getAttribute('aria-label')].join(' ').toLowerCase(),
        locked: e.disabled || e.readOnly,
      }));
      if (info.locked || SKIP_TYPES.has(info.type)) continue;
      todo.push({ i, ...info });
    }
    if (todo.length < 2) continue;

    for (const t of todo) {
      const el = fields.nth(t.i);
      if (t.tag === 'select') {
        await h.glide(el);
        await el.selectOption({ index: 1 }, { timeout: 5000 }).catch(() => {});
        await sleep(500);
      } else {
        await h.type(el, sampleFor(t));
      }
    }
    if (submit) {
      const btn = form.locator('button[type=submit], input[type=submit], button:not([type])').first();
      if (await btn.count()) {
        await h.click(btn);
        await sleep(2500);
      }
    }
    await sleep(800);
    return true;
  }
  return false;
}
