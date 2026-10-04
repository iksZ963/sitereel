const mmss = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * One-line progress bar with per-phase time limits.
 * phases: [{ id, label, weight, limit (seconds), auto? (ms; ease towards 100% when real % is unknown) }]
 */
export function createProgress(phases, { onTimeout } = {}) {
  const total = phases.reduce((a, p) => a + p.weight, 0);
  const t0 = Date.now();
  let idx = -1;
  let started = Date.now();
  let frac = 0;
  let detail = '';
  let lastLen = 0;
  let timedOut = false;

  const clear = () => process.stdout.write('\r' + ' '.repeat(lastLen) + '\r');

  function render() {
    if (idx < 0) return;
    const done = phases.slice(0, idx).reduce((a, p) => a + p.weight, 0);
    const pct = Math.min(99, Math.round(((done + phases[idx].weight * frac) / total) * 100));
    const width = 28;
    const filled = Math.round((pct / 100) * width);
    let line =
      `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${String(pct).padStart(3)}%  ` +
      `${phases[idx].label}${detail ? ' - ' + detail : ''}  (${mmss(Date.now() - t0)})`;
    const cols = (process.stdout.columns || 120) - 1;
    if (line.length > cols) line = line.slice(0, cols);
    process.stdout.write('\r' + line.padEnd(lastLen));
    lastLen = line.length;
  }

  const timer = setInterval(() => {
    if (idx < 0) return;
    const ph = phases[idx];
    if (ph.auto) frac = Math.max(frac, 1 - Math.exp(-(Date.now() - started) / ph.auto));
    render();
    if (!timedOut && Date.now() - started > ph.limit * 1000) {
      timedOut = true;
      onTimeout?.(`"${ph.label}" took longer than ${ph.limit}s, so it was stopped instead of hanging.`);
    }
  }, 250);
  timer.unref();

  return {
    start(id) {
      idx = phases.findIndex((p) => p.id === id);
      started = Date.now();
      frac = 0;
      detail = '';
      render();
    },
    set(f, d) {
      if (f != null) frac = Math.max(frac, Math.min(1, f));
      if (d !== undefined) detail = d;
      render();
    },
    log(msg) {
      clear();
      console.log(msg);
      lastLen = 0;
      render();
    },
    end() {
      clearInterval(timer);
      clear();
      lastLen = 0;
    },
    elapsed: () => mmss(Date.now() - t0),
  };
}
