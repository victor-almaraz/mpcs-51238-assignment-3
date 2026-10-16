import { expect, test } from '@playwright/test';
import { stressModel } from '../support/stress-model.js';

/*
 * CPU benchmark (a3-audio-implementation.md, CPU budget): renders the 20 s
 * stress project (16 tracks, 64 voices, 4 reverbs, 16 compressors, 16
 * saturators) with the engine on the main thread and measures wall time.
 * Pass: realtime factor ≥ 4 in Chromium (project limit). The `perf` project
 * runs it alone after the browser projects; run it by itself with
 * `--project=perf --no-deps`.
 */
const SECONDS = 20;
const MIN_FACTOR = 4;
/** Timed renders; the fastest counts, so a busy moment on the host does not fail the run. */
const RUNS = 3;

test('the stress project renders at least 4× faster than real time in Chromium', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The CPU benchmark target applies to Chromium.');
  test.setTimeout(240_000);
  await page.goto('/');
  const result = await page.evaluate(
    async ({ source, seconds, runs }) => {
      const { Engine } = await import('/worklets/dsp/engine/engine.js');
      const { BLOCK } = await import('/worklets/dsp/core/constants.js');
      const build = new Function(`return (${source});`)();
      const fs = 48000;
      const l = new Float32Array(BLOCK);
      const r = new Float32Array(BLOCK);
      let peak = 0;
      function render(frames) {
        const engine = new Engine(fs);
        engine.setModel(engine.prepareModel(build(fs, seconds)));
        engine.play(0);
        const t0 = performance.now();
        for (let f = 0; f < frames; f += BLOCK) {
          engine.process(l, r, 0, BLOCK);
          for (let i = 0; i < BLOCK; i++) if (Math.abs(l[i]) > peak) peak = Math.abs(l[i]);
        }
        return (performance.now() - t0) / 1000;
      }
      render(fs); // 1 s warm-up, so JIT compilation is not timed
      const walls = [];
      for (let i = 0; i < runs; i++) walls.push(render(fs * seconds));
      const wall = Math.min(...walls);
      return { factor: seconds / wall, wall, walls, peak, finite: Number.isFinite(peak) };
    },
    { source: stressModel.toString(), seconds: SECONDS, runs: RUNS },
  );
  console.log(`Stress render: best ${result.wall.toFixed(2)} s of ${result.walls.map((w) => w.toFixed(2)).join(', ')} s for ${SECONDS} s, realtime factor ${result.factor.toFixed(2)}`);
  expect(result.finite).toBe(true);
  expect(result.peak).toBeGreaterThan(0);
  expect(result.factor).toBeGreaterThanOrEqual(MIN_FACTOR);
});
