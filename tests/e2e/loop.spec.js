import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/*
 * The loop range: a band in the ruler with keyboard handles, drawn or edited
 * by pointer, and a playhead that follows the engine (playback that starts
 * after the loop end plays on).
 */

const PPQ = 960;
const BAR = 4 * PPQ;
const transport = (page) => page.getByRole('toolbar', { name: 'Transport' });
const loopStart = (page) => page.getByRole('slider', { name: 'Loop start' });
const loopEnd = (page) => page.getByRole('slider', { name: 'Loop end' });
const savedView = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('wrack:v1:view:'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });

async function openBeat(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
}

/** The ruler's x for the start of bar `n` (1-based), from the loop start handle at bar 1 and the loop end at bar 3. */
async function barX(page, n) {
  const a = await loopStart(page).boundingBox();
  const b = await loopEnd(page).boundingBox();
  return a.x + a.width / 2 + ((n - 1) * (b.x - a.x)) / 2;
}

test('the loop range shows in the ruler; dragging empty ruler space draws a loop and turns it on', async ({ page }) => {
  await openBeat(page);
  await expect(loopStart(page)).toHaveAttribute('aria-valuetext', 'bar 1');
  await expect(loopEnd(page)).toHaveAttribute('aria-valuetext', 'bar 3');
  await expect(transport(page).getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'false');
  const ruler = (await page.locator('canvas').first().boundingBox()).y + 12;
  const from = await barX(page, 5);
  const to = await barX(page, 7);
  await page.mouse.move(from + 2, ruler);
  await page.mouse.down();
  await page.mouse.move((from + to) / 2, ruler, { steps: 4 });
  await page.mouse.move(to - 2, ruler, { steps: 4 });
  await page.mouse.up();
  await expect(loopStart(page)).toHaveAttribute('aria-valuetext', 'bar 5');
  await expect(loopEnd(page)).toHaveAttribute('aria-valuetext', 'bar 7');
  await expect(transport(page).getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await savedView(page))?.loop).toEqual({ start: 4 * BAR, end: 6 * BAR });
  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="studio-timeline"]').analyze();
  expect(axe.violations).toEqual([]);
});

test('loop start and end handles move by grid steps and bars, and keep the loop at least one step long', async ({ page }) => {
  await openBeat(page);
  await loopEnd(page).focus();
  await page.keyboard.press('PageUp');
  await expect(loopEnd(page)).toHaveAttribute('aria-valuetext', 'bar 4');
  await loopStart(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(loopStart(page)).toHaveAttribute('aria-valuetext', 'bar 1 beat 2');
  await page.keyboard.press('End');
  // The 1/4 grid keeps one beat between the edges.
  await expect(loopStart(page)).toHaveAttribute('aria-valuenow', String(3 * BAR - PPQ));
  await expect(page.getByRole('status').filter({ hasText: /^Loop bar 3 beat 4 to bar 4/ })).toHaveCount(1);
});

test('with the loop on, playback that starts after the loop end plays on instead of jumping back', async ({ page }) => {
  await openBeat(page);
  await transport(page).getByRole('button', { name: 'Loop' }).click();
  // Locate to bar 4, after the 2-bar loop.
  await page.evaluate((tick) => globalThis.__wrackEngine.locate(tick), 3 * BAR);
  await transport(page).getByRole('button', { name: 'Play' }).click();
  await page.getByRole('alertdialog', { name: 'Volume notice' }).getByRole('button', { name: 'Continue' }).click();
  await expect(transport(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.waitForTimeout(1500);
  const tick = await page.evaluate(() => globalThis.__wrackEngine.positionTick());
  expect(tick).toBeGreaterThan(3 * BAR);
  await transport(page).getByRole('button', { name: 'Pause' }).click();
  // Pause keeps the real position, not one wrapped into the loop.
  expect(await page.evaluate(() => globalThis.__wrackEngine.positionTick())).toBeGreaterThan(3 * BAR);
});
