import { detectPlan, isUp } from './server.mjs';
import { findFfmpeg, hasChromium } from './env.mjs';

/** `sitereel doctor`: check that everything needed is in place. */
export async function doctor(cfg = {}) {
  const rows = [];
  const add = (ok, label, hint) => rows.push({ ok, label, hint });

  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 18, `Node ${process.versions.node}`, 'Node 18 or newer is required.');

  add(hasChromium(), 'Chromium browser', 'Not installed yet. It is downloaded automatically on the first run (or: npx playwright install chromium).');

  const ff = await findFfmpeg();
  add(!!ff, ff ? `ffmpeg (${ff.source})` : 'ffmpeg', 'Needed for .mp4 output. It is downloaded automatically the first time you record, or install ffmpeg yourself. You still get a .webm without it.');

  try {
    const plan = detectPlan(process.cwd(), cfg);
    add(true, `Project detected: ${plan.label}`);
    if (await isUp(`http://127.0.0.1:${plan.port}`)) {
      add(false, `Port ${plan.port} is already in use`, 'Stop whatever is running there, or set server.port in sitereel.config.mjs.');
    }
    if (plan.label === 'Next.js' && (await isUp('http://127.0.0.1:3000'))) {
      add(false, 'Something is running on :3000', 'If it is `next dev`, stop it before building, or use: sitereel --url http://localhost:3000');
    }
  } catch (e) {
    add(false, 'Project detection', String(e.message).split('\n')[0] + ' (you can still use --url)');
  }

  console.log('\nsitereel doctor\n');
  for (const r of rows) {
    console.log(`  ${r.ok ? '[ok]' : '[!!]'} ${r.label}`);
    if (!r.ok && r.hint) console.log(`       ${r.hint}`);
  }
  const bad = rows.filter((r) => !r.ok).length;
  console.log(bad ? `\n${bad} thing(s) to look at.` : '\nAll good.');
  return bad === 0;
}
