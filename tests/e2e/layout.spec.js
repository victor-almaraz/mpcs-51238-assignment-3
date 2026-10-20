import { expect, test } from '@playwright/test';
import { openTab } from '../support/editor.js';

const EFFECTS = ['EQ', 'Filter', 'Compressor', 'Saturation', 'Distortion', 'Delay', 'Reverb'];

/** Overlapping in-flow siblings under `selector`, outside SVG drawings, beyond a 2 px shared border. */
function overlaps(selector) {
  const shown = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.closest('.sr-only') && r.width > 0 && r.height > 0;
  };
  const inFlow = (el) => !['absolute', 'fixed'].includes(getComputedStyle(el).position);
  const found = [];
  for (const el of document.querySelector(selector).querySelectorAll('*')) {
    if (el.closest('svg') || !shown(el)) continue;
    const kids = [...el.children].filter((k) => shown(k) && inFlow(k)).map((k) => [k, k.getBoundingClientRect()]);
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const [a, ra] = kids[i];
        const [b, rb] = kids[j];
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 2 && h > 2) found.push(`${a.textContent.trim().slice(0, 30)} / ${b.textContent.trim().slice(0, 30)}`);
      }
    }
  }
  return found;
}

test('the Devices panel never draws effects over the instrument, however long the chain', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('treegrid', { name: 'Tracks and clips' })).toBeVisible();
  await openTab(page, 'Devices');
  const panel = page.locator('#dock-panel-devices');
  const add = panel.getByRole('button', { name: 'Add effect' });
  for (const fx of EFFECTS) {
    await panel.getByLabel('Effect', { exact: true }).selectOption({ label: fx });
    await add.click(); // fails if any element covers the button
    await expect(panel.getByRole('group', { name: new RegExp(`^${fx}\\b`) }).first()).toBeVisible();
  }
  const instrument = panel.getByRole('region', { name: /^Subtractive synth: / });
  const chain = panel.locator('section[aria-labelledby^="chain-"]');
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const a = await instrument.boundingBox();
    const b = await chain.boundingBox();
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    expect(await page.evaluate(overlaps, '#dock-panel-devices')).toEqual([]);
    // The Add effect button is the topmost element at its centre.
    await add.scrollIntoViewIfNeeded();
    const box = await add.boundingBox();
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit).toBe('Add effect');
  }
});
