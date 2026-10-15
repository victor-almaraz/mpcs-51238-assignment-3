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
