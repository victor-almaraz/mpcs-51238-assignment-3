import { expect, test } from '@playwright/test';
import { openTab } from '../support/editor.js';

/*
 * Levels: the latched clip indicator on track strips (MIX-02) and the safety
 * limiter group that ends the master chain (SAFE-02).
 */

async function openBeat(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
}

test('a track that passes 0 dBFS latches its clip indicator until it is cleared', async ({ page }) => {
  await openBeat(page);
  await openTab(page, 'Mixer');
  await expect(page.getByRole('button', { name: /^Clear clip indicator/ })).toHaveCount(0);
  // Meter frames carry linear peaks per track; 2.0 on the first track is +6 dBFS.
  await page.evaluate(() => {
    const engine = globalThis.__wrackEngine;
    engine.realGetMeters = engine.getMeters;
    const frame = new Float32Array(256);
    frame[0] = 2;
    frame[1] = 2;
    engine.getMeters = () => frame;
  });
  const clear = page.getByRole('button', { name: /^Clear clip indicator, .+ clipped$/ }).first();
  await expect(clear).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Drums clipped$/ })).toHaveCount(1);
  await expect(clear).toHaveAccessibleName('Clear clip indicator, Drums clipped');
  await page.evaluate(() => {
    const engine = globalThis.__wrackEngine;
    engine.getMeters = engine.realGetMeters;
  });
  await clear.click();
  await expect(page.getByRole('button', { name: /^Clear clip indicator/ })).toHaveCount(0);
});

test('the master chain ends in the safety limiter, which takes no slot', async ({ page }) => {
  await openBeat(page);
  await openTab(page, 'Devices');
  await page.getByRole('group', { name: 'Chain' }).getByText('Master').click();
  const master = page.getByRole('region', { name: 'Master effects' });
  const limiter = master.getByRole('group', { name: /^Safety limiter, always on, gain reduction \d+\.\d dB$/ });
  await expect(limiter).toBeVisible();
  await expect(limiter).toContainText('Ceiling −1 dBFS');
  await expect(limiter.getByRole('button')).toHaveCount(0);
  await expect(master).toContainText('of 8 slots used.');
});
