import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('home renders one h1 and has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('the worklet module is served without caching', async ({ request }) => {
  const res = await request.get('/worklets/worklet/main.js');
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-cache');
  expect(res.headers()['content-type']).toContain('javascript');
});

test('the worklet module registers in an AudioContext', async ({ page }) => {
  await page.goto('/');
  const registered = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 48000 });
    await ctx.audioWorklet.addModule('/worklets/worklet/main.js');
    const engine = new AudioWorkletNode(ctx, 'wrack-engine', { numberOfInputs: 0, outputChannelCount: [2] });
    const safety = new AudioWorkletNode(ctx, 'wrack-safety', { outputChannelCount: [2] });
    engine.connect(safety).connect(ctx.destination);
    return true;
  });
  expect(registered).toBe(true);
});

test('the safety processor limits a loud input and fades it in', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const fs = 48000;
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: fs / 2, sampleRate: fs });
    await ctx.audioWorklet.addModule('/worklets/worklet/main.js');
    const safety = new AudioWorkletNode(ctx, 'wrack-safety', { outputChannelCount: [2] });
    // Test input only: app code never uses native source nodes.
    const loud = new ConstantSourceNode(ctx, { offset: 10 });
    const wobble = new OscillatorNode(ctx, { frequency: 1000, type: 'square' });
    const wobbleGain = new GainNode(ctx, { gain: 5 });
    wobble.connect(wobbleGain).connect(safety);
    loud.connect(safety).connect(ctx.destination);
    loud.start();
    wobble.start();
    const buffer = await ctx.startRendering();
    let peak = 0;
    let onset = 0;
    let finite = true;
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (!Number.isFinite(data[i])) finite = false;
        if (a > peak) peak = a;
        if (i < 0.01 * fs && a > onset) onset = a;
      }
    }
    return { peak, onset, finite };
  });
  expect(result.finite).toBe(true);
  expect(result.peak).toBeLessThanOrEqual(0.8913);
  expect(result.peak).toBeGreaterThan(0.5);
  expect(result.onset).toBeLessThanOrEqual(0.02);
});
