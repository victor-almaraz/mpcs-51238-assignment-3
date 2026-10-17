import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Creates a project through the form and returns its ID. */
async function createProject(page, name = 'Roll') {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return new URL(page.url()).pathname.split('/').pop();
}

const saved = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);
const allNotes = (doc) => Object.values(doc.clips).flatMap((c) => c.notes);
const roll = (page, name) => page.getByRole('region', { name: `Piano roll: ${name}` }).getByRole('grid', { name: 'Notes' });
const cursorCell = (grid) => grid.locator('[tabindex="0"]');

/** Turns note preview off, so editing makes no sound and opens no volume notice. */
async function silence(page) {
  await page.getByRole('toolbar', { name: 'Piano roll tools' }).getByRole('button', { name: 'Preview notes' }).click();
}

test('keyboard only: create, move, transpose, lengthen, change velocity and delete a note', async ({ page }) => {
  const id = await createProject(page);
  await silence(page);
  const grid = roll(page, 'Track 1');
  await cursorCell(grid).focus();
  await expect(cursorCell(grid)).toHaveAccessibleName('C4, bar 1 beat 1');
  await page.keyboard.press('Enter');
  await expect(cursorCell(grid)).toHaveAccessibleName('C4, bar 1 beat 1, length 0.25 beats, velocity 100');
  await expect(page.getByRole('status').filter({ hasText: 'Added C4, bar 1 beat 1, length 0.25 beats, velocity 100' })).toHaveCount(1);

  await page.keyboard.press('Alt+ArrowRight');
  await expect(cursorCell(grid)).toHaveAccessibleName('C4, bar 1 beat 1 step 2, length 0.25 beats, velocity 100');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(cursorCell(grid)).toHaveAccessibleName('C#4, bar 1 beat 1 step 2, length 0.25 beats, velocity 100');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(cursorCell(grid)).toHaveAccessibleName('C#4, bar 1 beat 1 step 2, length 0.5 beats, velocity 100');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(cursorCell(grid)).toHaveAccessibleName('C#4, bar 1 beat 1 step 2, length 0.5 beats, velocity 108');

  await expect.poll(async () => allNotes(await saved(page, id))).toEqual([
    expect.objectContaining({ tick: 240, pitch: 61, length: 480, velocity: 108 }),
  ]);
  await page.keyboard.press('Delete');
  await expect(cursorCell(grid)).toHaveAccessibleName('C#4, bar 1 beat 1 step 2');
  await expect.poll(async () => allNotes(await saved(page, id)).length).toBe(0);
});

test('arrow keys move the cursor across cells and rows; the DOM mirror matches the model', async ({ page }) => {
  test.slow(); // axe over the whole editor takes most of the default timeout under parallel load
  const id = await createProject(page);
  await silence(page);
  const grid = roll(page, 'Track 1');
  await cursorCell(grid).focus();
  for (const keys of [[], ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight'], ['ArrowUp', 'ArrowUp'], ['ArrowDown', 'ArrowDown', 'ArrowDown']]) {
    for (const key of keys) await page.keyboard.press(key);
    await page.keyboard.press('Enter');
  }
  await expect(grid.locator('[data-note="start"]')).toHaveCount(4);
  await expect.poll(async () => allNotes(await saved(page, id)).length).toBe(4);
  const notes = allNotes(await saved(page, id));
  expect(notes.map((n) => [n.tick, n.pitch])).toEqual([[0, 60], [960, 60], [960, 62], [960, 59]]);
  await page.keyboard.press('Home');
  await expect(cursorCell(grid)).toHaveAccessibleName(/^B3, bar 1 beat 1/);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('pointer: a click adds a note, a double-click removes it', async ({ page }) => {
  const id = await createProject(page);
  await silence(page);
  const grid = roll(page, 'Track 1');
  const cell = grid.getByRole('gridcell', { name: 'C4, bar 1 beat 3', exact: true });
  await cell.click();
  await expect(grid.locator('[data-note="start"]')).toHaveCount(1);
  await expect.poll(async () => allNotes(await saved(page, id)).length).toBe(1);
  await grid.getByRole('gridcell', { name: /^C4, bar 1 beat 3, length/ }).dblclick();
  await expect(grid.locator('[data-note="start"]')).toHaveCount(0);
});

test('Quantize and the clip loop length edit the clip', async ({ page }) => {
  const id = await createProject(page);
  await silence(page);
  const grid = roll(page, 'Track 1');
  await cursorCell(grid).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const tools = page.getByRole('toolbar', { name: 'Piano roll tools' });
  await tools.getByRole('combobox', { name: 'Grid' }).selectOption('1/4');
  await tools.getByRole('button', { name: 'Quantize' }).click();
  await expect.poll(async () => allNotes(await saved(page, id))[0]?.tick).toBe(0);
  await tools.getByRole('combobox', { name: 'Clip loop' }).selectOption('1 bar');
  await expect.poll(async () => Object.values((await saved(page, id)).clips)[0].loopLength).toBe(3840);
});

test('step input: computer-keyboard notes insert at the cursor and advance it', async ({ page }) => {
  const id = await createProject(page);
  await silence(page);
  await page.evaluate(() => localStorage.setItem('w-rack:v1:settings', JSON.stringify({ volumeNoticeDismissed: true })));
  await page.reload();
  await silence(page);
  // An empty clip opens in step input.
  await expect(page.getByRole('toolbar', { name: 'Piano roll tools' }).getByRole('button', { name: 'Step input' })).toHaveAttribute('aria-pressed', 'true');
  const grid = roll(page, 'Track 1');
  await cursorCell(grid).focus();
  await page.keyboard.press('KeyA');
  await page.keyboard.press('KeyD');
  await page.keyboard.press('KeyG');
  await expect.poll(async () => allNotes(await saved(page, id)).map((n) => [n.tick, n.pitch])).toEqual([[0, 60], [240, 64], [480, 67]]);
});

test('drum rows: GM labels, the choke group, and Show all notes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  const grid = roll(page, 'Drums');
  await expect(grid).toHaveAttribute('aria-rowcount', '21');
  await expect(grid.getByRole('rowheader', { name: /^36 Kick \(Bass Drum 1\)/ })).toBeVisible();
  await expect(grid.getByRole('rowheader', { name: /^42 Closed hat \(Closed Hi-Hat\)/ })).toContainText('Choke group');
  await expect(grid.getByRole('gridcell', { name: '36 Kick (Bass Drum 1), bar 1 beat 1, length 0.25 beats, velocity 120' })).toHaveCount(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('toolbar', { name: 'Piano roll tools' }).getByRole('button', { name: 'Show all notes' }).click();
  await expect(grid).toHaveAttribute('aria-rowcount', '128');
});

test('Space on a drum row header auditions the voice', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('w-rack:v1:settings', JSON.stringify({ volumeNoticeDismissed: true })));
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  const grid = roll(page, 'Drums');
  await cursorCell(grid).focus();
  await page.keyboard.press('ArrowLeft');
  // The roll opens on the median drum note (42); rows run 35, 36, … 42.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
  await expect(grid.getByRole('button', { name: '36 Kick (Bass Drum 1)' })).toBeFocused();
  // The first audition starts audio, inside the safety stage's 50 ms fade-in. The
  // frozen macOS 13 WebKit build renders headless audio unevenly, so later
  // auditions are measured over a longer window.
  await page.keyboard.press(' ');
  await page.waitForTimeout(500);
  await expect(page.getByRole('toolbar', { name: 'Transport' }).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const measuring = page.evaluate(async () => {
    let most = 0;
    const until = performance.now() + 2000;
    while (performance.now() < until) {
      const l = window.__wrackEngine.getMasterLevel();
      most = Math.max(most, l.peakL, l.peakR);
      await new Promise((r) => setTimeout(r, 20));
    }
    return most;
  });
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(' ');
    await page.waitForTimeout(400);
  }
  const peak = await measuring;
  expect(peak).toBeGreaterThan(0.005);
});

test('clicking a row label previews without adding a note', async ({ page }) => {
  const id = await createProject(page);
  await page.evaluate(() => localStorage.setItem('w-rack:v1:settings', JSON.stringify({ volumeNoticeDismissed: true })));
  await page.reload();
  const grid = roll(page, 'Track 1');
  await grid.getByRole('button', { name: 'C4', exact: true }).click();
  await page.waitForTimeout(300);
  await expect(grid.locator('[data-note="start"]')).toHaveCount(0);
  expect(Object.keys((await saved(page, id)).clips)).toEqual([]);
});

test('dragging a note moves it in one edit', async ({ page }) => {
  const id = await createProject(page);
  await silence(page);
  const grid = roll(page, 'Track 1');
  await grid.getByRole('gridcell', { name: 'C4, bar 1 beat 1', exact: true }).click();
  const note = grid.locator('[data-note="start"]');
  await expect(note).toHaveCount(1);
  // Read the box after the click, which may scroll the cell into view.
  const box = await note.boundingBox();
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 12 + 24, box.y + 12 - 24, { steps: 4 });
  await page.mouse.move(box.x + 12 + 48, box.y + 12 - 24, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => allNotes(await saved(page, id)).map((n) => [n.tick, n.pitch])).toEqual([[480, 61]]);
  await expect(grid.getByRole('gridcell', { name: /^C#4, bar 1 beat 1 step 3, length/ })).toHaveCount(1);
});

test('stacked notes in one cell are named together', async ({ page }) => {
  const id = await createProject(page);
  await silence(page);
  const grid = roll(page, 'Track 1');
  await cursorCell(grid).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async () => allNotes(await saved(page, id)).length).toBe(2);
  await expect(cursorCell(grid)).toHaveAccessibleName('C4, bar 1 beat 1, length 0.25 beats, velocity 100, and 1 more note');
});
