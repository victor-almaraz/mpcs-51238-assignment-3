import { expect, test } from '@playwright/test';
import { openTab } from '../support/editor.js';

/*
 * Editor regressions: pointer clip moves, undo and redo, tempo edits during
 * playback, a page that never scrolls, the sticky ruler, and renaming MIDI clips.
 */

const PPQ = 960;
const BAR = 4 * PPQ;
const transport = (page) => page.getByRole('toolbar', { name: 'Transport' });
const tree = (page) => page.getByRole('treegrid', { name: 'Tracks and clips' });
const clipRow = (page, name) => tree(page).locator('[role="row"][aria-level="2"]').filter({ hasText: name }).first();
const savedDoc = (page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('w-rack:v1:project:'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
const clipNamed = async (page, name) => Object.values((await savedDoc(page))?.clips ?? {}).find((c) => c.name === name);

async function openBeat(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
}

test('dragging a clip with the pointer moves it by the grid', async ({ page }) => {
  await openBeat(page);
  const box = await clipRow(page, 'Bass').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 20, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, y, { steps: 4 });
  await page.mouse.move(box.x + 20 + 4 * 32, y, { steps: 4 });
  await page.mouse.up();
  // 32 px per quarter note at 100 %: four beats is one bar.
  await expect.poll(async () => (await clipNamed(page, 'Bass'))?.start).toBe(BAR);
});

test('undo and redo step through edits; a text field keeps its own undo', async ({ page }) => {
  await openBeat(page);
  await clipRow(page, 'Lead stab').click();
  await page.getByRole('toolbar', { name: 'Clip commands' }).getByRole('button', { name: 'Delete clip' }).click();
  await expect.poll(async () => Object.keys((await savedDoc(page))?.clips ?? {}).length).toBe(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => Object.keys((await savedDoc(page))?.clips ?? {}).length).toBe(3);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => Object.keys((await savedDoc(page))?.clips ?? {}).length).toBe(2);
  // In the tempo field, Ctrl/Cmd+Z belongs to the field.
  const tempo = transport(page).getByRole('textbox', { name: 'Tempo (BPM)' });
  await tempo.fill('120');
  await tempo.press('ControlOrMeta+z');
  expect(Object.keys((await savedDoc(page))?.clips ?? {})).toHaveLength(2);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Undo/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a tempo edit while playing keeps the musical position', async ({ page }) => {
  await openBeat(page);
  await transport(page).getByRole('button', { name: 'Play' }).click();
  await page.getByRole('alertdialog', { name: 'Volume notice' }).getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(1500);
  const tempo = transport(page).getByRole('textbox', { name: 'Tempo (BPM)' });
  const before = await page.evaluate(() => globalThis.__wrackEngine.positionTick());
  await tempo.fill('200');
  await tempo.press('Enter');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => globalThis.__wrackEngine.positionTick());
  // At most about half a second of playback at the new tempo, never a jump of bars.
  expect(after - before).toBeGreaterThanOrEqual(0);
  expect(after - before).toBeLessThan(BAR);
});

test('the editor page never scrolls, whatever the dock shows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openBeat(page);
  for (const tab of ['Devices', 'Mixer', 'Editor']) {
    await openTab(page, tab);
    const [h, w] = await page.evaluate(() => [document.scrollingElement.scrollHeight, document.scrollingElement.scrollWidth]);
    expect(h, `${tab} height`).toBeLessThanOrEqual(720);
    expect(w, `${tab} width`).toBeLessThanOrEqual(1280);
  }
});

test('the ruler and loop handles stay in view while tracks scroll', async ({ page }) => {
  await openBeat(page);
  const add = page.getByRole('toolbar', { name: 'Clip commands' }).getByRole('button', { name: 'Add', exact: true });
  for (let i = 0; i < 6; i++) {
    await add.click();
    await page.getByRole('menuitem', { name: 'Audio track' }).click();
  }
  const scroller = page.locator('section[aria-labelledby="studio-timeline"] canvas').locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]');
  const top = (await scroller.boundingBox()).y;
  await scroller.evaluate((el) => el.scrollTo(0, 200));
  await page.waitForTimeout(100);
  const handle = await page.getByRole('slider', { name: 'Loop start' }).boundingBox();
  expect(Math.abs(handle.y - top)).toBeLessThan(2);
});

test('Rename clip opens a name field for a MIDI clip', async ({ page }) => {
  await openBeat(page);
  await clipRow(page, 'Bass').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename clip…' }).click();
  const field = page.getByRole('dialog', { name: 'Rename Bass' }).getByRole('textbox', { name: 'Clip name' });
  await expect(field).toBeFocused();
  await field.fill('Bassline');
  await field.press('Enter');
  await expect.poll(async () => (await clipNamed(page, 'Bassline'))?.kind).toBe('midi');
});
