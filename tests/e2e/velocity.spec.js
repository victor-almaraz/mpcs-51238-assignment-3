import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/*
 * Velocity lane (PR-03): one slider on the selected note, named "Velocity C4
 * bar 1.1", with Arrow, Page Up/Down and Home/End keys; Shift+Left/Right
 * pick another note; a drag paints several notes.
 */

async function createProject(page, name = 'Dynamics') {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return new URL(page.url()).pathname.split('/').pop();
}

const saved = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);
const velocities = async (page, id) => Object.values((await saved(page, id)).clips).flatMap((c) => c.notes.map((n) => n.velocity));

test('the lane edits the selected note by keyboard and several notes by a drag', async ({ page }) => {
  const id = await createProject(page);
  await page.getByRole('toolbar', { name: 'Piano roll tools' }).getByRole('button', { name: 'Preview notes' }).click();
  const grid = page.getByRole('grid', { name: 'Notes' });
  await grid.locator('[tabindex="0"]').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');

  const lane = page.getByRole('slider', { name: /^Velocity C4 bar 1\.2$/ });
  await expect(lane).toHaveAttribute('aria-valuenow', '100');
  await lane.focus();
  await page.keyboard.press('ArrowUp');
  await expect(lane).toHaveAttribute('aria-valuenow', '101');
  await page.keyboard.press('PageDown');
  await expect(lane).toHaveAttribute('aria-valuenow', '91');
  await page.keyboard.press('End');
  await expect(lane).toHaveAttribute('aria-valuenow', '127');
  await page.keyboard.press('Shift+ArrowLeft');
  const first = page.getByRole('slider', { name: 'Velocity C4 bar 1.1' });
  await expect(first).toHaveAttribute('aria-valuenow', '100');
  await first.focus();
  await page.keyboard.press('Home');
  await expect(first).toHaveAttribute('aria-valuenow', '1');
  await expect.poll(() => velocities(page, id)).toEqual([1, 127]);
  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="pianoroll-heading"]').analyze();
  expect(axe.violations).toEqual([]);

  // A drag along the lane's middle paints both notes to about 64.
  const box = await page.getByText('Velocity', { exact: true }).locator('xpath=../..').boundingBox();
  const y = box.y + 1 + 24;
  // Stems sit 2 px right of their column: x = 210 and 306 for ticks 0 and 960 at 1/16.
  await page.mouse.move(box.x + 212, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, y, { steps: 6 });
  await page.mouse.move(box.x + 308, y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await velocities(page, id)).every((v) => v > 50 && v < 80)).toBe(true);
});
