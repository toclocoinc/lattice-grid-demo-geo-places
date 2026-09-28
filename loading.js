// The page's loading state: the status line and an overlay over the panels
// show the current step from the first paint, with a running byte count for
// the remote partition, until the first real rows are in the grid. A step
// that throws, or a first load that has not answered inside the timeout,
// becomes a plain error line naming the step, with a Retry button.
const el = (id) => document.getElementById(id);
export const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(2)} MB`);

export function createLoader({ timeoutMs = 120_000, pollMs = 500 } = {}) {
  const t0 = Date.now();
  let step = { name: 'starting', text: 'Starting…' };
  let bytes = 0;
  let readBytes = null; // set once the engine can report the partition's bytes
  let reading = false; // one statistics call in flight at a time: the worker answers only between queries
  let timer = null;
  let failed = false;

  const render = (text) => {
    el('status').textContent = text;
    el('loading-text').textContent = text;
  };
  const renderStep = () => {
    if (failed) return;
    const elapsed = Math.round((Date.now() - t0) / 1000);
    render(`${step.text} ${fmtBytes(bytes)} fetched from the partition so far, ${elapsed} s elapsed.`);
    el('t-bytes').textContent = fmtBytes(bytes);
  };
  const poll = setInterval(async () => {
    renderStep();
    if (!readBytes || reading) return;
    reading = true;
    try { bytes = await readBytes(); } catch (e) { console.warn('[places demo] byte count unavailable', e); }
    reading = false;
  }, pollMs);

  const loader = {
    /** Announce a step; `name` is what an error line names. */
    step(name, text) { step = { name, text }; renderStep(); },
    /** From now on the byte count comes from `fn()` every `pollMs`. */
    countBytes(fn) { readBytes = fn; },
    /** Start the clock: `fail()` fires if `rowsIn()` has not been called in time. */
    armTimeout() {
      clearTimeout(timer);
      timer = setTimeout(() => loader.fail(new Error(`no answer after ${timeoutMs / 1000} s`)), timeoutMs);
    },
    /** The first query answered: the rows are visible, so the overlay and the clock stop. */
    rowsIn(name, text) {
      clearTimeout(timer);
      el('loading').hidden = true;
      loader.step(name, text);
    },
    done(text) {
      clearTimeout(timer); clearInterval(poll);
      el('loading').hidden = true;
      el('status').textContent = text;
    },
    fail(error) {
      if (failed) return;
      failed = true;
      clearTimeout(timer); clearInterval(poll);
      console.error(`[places demo] failed at step "${step.name}":`, error);
      const message = error && error.message ? error.message : String(error);
      render(`Failed while ${step.name}: ${message}`);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => location.reload());
      el('status').append(' ', retry);
    },
  };
  return loader;
}
