import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { menuItem } from '../support/editor.js';

/*
 * Command palette, clip context menu, timeline marquee and the on-canvas
 * fade, gain and envelope handles (accessibility.md, Command system;
 * design-patterns.md, ARR-02, ARR-03, ARR-05).
 */

function wav(seconds = 2) {
  const rate = 48000;
  const frames = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + 2 * frames);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + 2 * frames, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(2 * frames, 40);
  for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 330 * i) / rate)), 44 + 2 * i);
  return b;
}

async function projectWithAudio(page, files = [{ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav() }]) {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Tools');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tools');
  const id = new URL(page.url()).pathname.split('/').pop();
  await page.locator('input[type="file"][accept^="audio"]').first().setInputFiles(files);
  await expect(clipRows(page)).toHaveCount(files.length);
  return id;
}

const clipRows = (page) => page.getByRole('treegrid', { name: 'Tracks and clips' }).locator('[role="row"][aria-level="2"]');
const saved = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `wrack:v1:project:${id}`);
const audioClip = async (page, id) => Object.values((await saved(page, id))?.clips ?? {}).find((c) => c.kind === 'audio');

/** Canvas geometry, as in src/components/timeline/layout.js: ruler and track heights. */
const RULER_H = 24;
const TRACK_H = 56;

/** Canvas point `x` px right, `dy` px into clip row `row` (clips inset 3 px; 32 px per quarter note at zoom 1). */
async function canvasPoint(page, x, row, dy) {
  const canvas = page.locator('section[aria-labelledby="studio-timeline"] canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  return { x: box.x + x, y: box.y + RULER_H + row * TRACK_H + 3 + dy };
}

test('the command palette opens from the header and Mod+K, filters, and runs commands', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('ControlOrMeta+K');
  const dialog = page.getByRole('dialog', { name: 'Commands' });
  const search = dialog.getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await expect(dialog.getByRole('option', { name: /Transport: Play/ })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(axe.violations).toEqual([]);
  await search.fill('zoom in');
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await expect(dialog.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Zoom 200%')).toBeVisible();

  await page.getByRole('banner').getByRole('button', { name: 'Commands' }).click();
  await search.fill('go to settings');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
});

test('the clip menu opens with Shift+F10 and on right-click, keeps focus, and runs clip commands', async ({ page }) => {
  const id = await projectWithAudio(page);
  const row = clipRows(page).first();
  await row.click();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Clip actions: tone' });
  await expect(menu.getByRole('menuitem', { name: /^Split at edit cursor/ })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: /^Split at edit cursor/ })).toContainText('The edit cursor is outside this clip.');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: /^Join clips/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(row).toBeFocused();

  const p = await canvasPoint(page, 40, 1, 30);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Duplicate clip' }).click();
  await expect(clipRows(page)).toHaveCount(2);
  await clipRows(page).first().press('ContextMenu');
  await menu.getByRole('menuitem', { name: 'Mute clip' }).click();
  await expect.poll(async () => Object.values((await saved(page, id)).clips).filter((c) => c.muted).length).toBe(1);
});

test('a marquee drag in empty timeline space selects the clips it touches', async ({ page }) => {
  await projectWithAudio(page, [
    { name: 'one.wav', mimeType: 'audio/wav', buffer: wav(1) },
    { name: 'two.wav', mimeType: 'audio/wav', buffer: wav(1) },
  ]);
  // The clips sit on row 1 from x = 0 to 128 (two 1 s clips at 120 BPM); the drag starts in empty space to their right.
  const from = await canvasPoint(page, 300, 1, 40);
  const to = await canvasPoint(page, 20, 1, 10);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, from.y - 10, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect(clipRows(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(clipRows(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('status').filter({ hasText: '2 clips selected' })).toHaveCount(1);
  // A click without a drag clears the selection and moves the edit cursor.
  const empty = await canvasPoint(page, 400, 1, 20);
  await page.mouse.click(empty.x, empty.y);
  await expect(clipRows(page).nth(0)).toHaveAttribute('aria-selected', 'false');
});

test('fade, gain and envelope handles on a selected audio clip edit it by pointer', async ({ page }) => {
  const id = await projectWithAudio(page);
  await clipRows(page).first().click();
  // Fade-in handle: the 24 px target right of the fade-in's end (x = 0 with no fade).
  const fadeFrom = await canvasPoint(page, 8, 1, 8);
  await page.mouse.move(fadeFrom.x, fadeFrom.y);
  await page.mouse.down();
  await page.mouse.move(fadeFrom.x + 30, fadeFrom.y, { steps: 3 });
  await page.mouse.move(fadeFrom.x + 52, fadeFrom.y, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await audioClip(page, id))?.fadeIn.length).toBeGreaterThan(30000);

  // Gain handle at the top centre (x = 64): 40 px up is +10 dB.
  const gainFrom = await canvasPoint(page, 64, 1, 8);
  await page.mouse.move(gainFrom.x, gainFrom.y);
  await page.mouse.down();
  await page.mouse.move(gainFrom.x, gainFrom.y - 20, { steps: 3 });
  await page.mouse.move(gainFrom.x, gainFrom.y - 40, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await audioClip(page, id))?.gainDb).toBe(10);

  // Double-click in the clip adds an envelope point; double-clicking the point removes it.
  const at = await canvasPoint(page, 96, 1, 25);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(async () => (await audioClip(page, id))?.envelope.length).toBe(1);
  const point = (await audioClip(page, id)).envelope[0];
  expect(point.gain).toBeGreaterThan(0.9);
  expect(point.gain).toBeLessThan(1.1);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(async () => (await audioClip(page, id))?.envelope.length).toBe(0);
});

test('the top of a MIDI clip right edge loops the clip; the lower part and the Clip menu still work', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Loops');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Loops');
  const id = new URL(page.url()).pathname.split('/').pop();
  await page.getByRole('toolbar', { name: 'Piano roll tools' }).getByRole('button', { name: 'Preview notes' }).click();
  // The first note makes a two-bar clip on row 0 (x 0 to 256 at 128 px per bar).
  const cell = page.getByRole('grid', { name: 'Notes' }).locator('[tabindex="0"]');
  await cell.focus();
  await page.keyboard.press('Enter');
  const midi = async () => Object.values((await saved(page, id))?.clips ?? {}).find((c) => c.kind === 'midi');
  await expect.poll(async () => (await midi())?.length).toBe(2 * 3840);

  const from = await canvasPoint(page, 254, 0, 8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 128, from.y, { steps: 4 });
  await page.mouse.move(from.x + 256, from.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => [(await midi()).length, (await midi()).loopLength]).toEqual([4 * 3840, 2 * 3840]);
  await expect(clipRows(page).first()).toHaveAccessibleName(/loops every 2 bars/);

  await clipRows(page).first().press('ContextMenu');
  await page.getByRole('menu').getByRole('menuitem', { name: 'Stop looping clip' }).click();
  await expect.poll(async () => [(await midi()).loopLength, (await midi()).notes.length]).toEqual([undefined, 2]);
  // The lower part of the edge lengthens without repeating: the clip is four bars (x 512).
  const low = await canvasPoint(page, 510, 0, 40);
  await page.mouse.move(low.x, low.y);
  await page.mouse.down();
  await page.mouse.move(low.x + 64, low.y, { steps: 4 });
  await page.mouse.move(low.x + 128, low.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => [(await midi()).length, (await midi()).loopLength, (await midi()).notes.length]).toEqual([5 * 3840, undefined, 2]);
  await clipRows(page).first().press('ContextMenu');
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Loop clip' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('the top of an audio clip right edge loops it; the end trim keys and the Clip menu work on the loop', async ({ page }) => {
  const id = await projectWithAudio(page);
  const audio = async () => Object.values((await saved(page, id))?.clips ?? {}).filter((c) => c.kind === 'audio').sort((a, b) => a.start - b.start);
  // The 2 s clip is one bar at 120 BPM: row 1, x 0 to 128. Dragging the top of its right edge two bars repeats it twice.
  const from = await canvasPoint(page, 126, 1, 8);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 128, from.y, { steps: 4 });
  await page.mouse.move(from.x + 256, from.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await audio()).map((c) => [c.length, c.loopLength, c.sourceLength])).toEqual([[3 * 3840, 3840, 96000]]);
  await expect(clipRows(page).first()).toHaveAccessibleName(/loops every 1 bar/);

  // With looping on, the end trim keys lengthen and shorten the loop.
  await clipRows(page).first().focus();
  await page.keyboard.press('Alt+Shift+ArrowRight');
  await expect.poll(async () => (await audio())[0].length).toBeGreaterThan(3 * 3840);
  await page.keyboard.press('Alt+Shift+ArrowLeft');
  await expect.poll(async () => (await audio())[0].length).toBe(3 * 3840);
  expect((await audio())[0].sourceLength).toBe(96000);

  // Stop looping writes the passes out as clips that read the same audio.
  await clipRows(page).first().press('ContextMenu');
  await page.getByRole('menu').getByRole('menuitem', { name: 'Stop looping clip' }).click();
  await expect(clipRows(page)).toHaveCount(3);
  await expect.poll(async () => (await audio()).map((c) => [c.start, c.sourceOffset, c.sourceLength, c.loopLength])).toEqual([
    [0, 0, 96000, undefined],
    [3840, 0, 96000, undefined],
    [7680, 0, 96000, undefined],
  ]);
  await expect(page.getByRole('status').filter({ hasText: 'no longer looping; repeats kept as clips' })).toHaveCount(1);

  // Loop clip in the Clip menu turns looping on again at the clip's length.
  await clipRows(page).first().press('ContextMenu');
  await page.getByRole('menu').getByRole('menuitem', { name: 'Loop clip' }).click();
  await expect.poll(async () => (await audio())[0].loopLength).toBe(3840);
});

test('a duplicated MIDI clip is edited on its own: selecting the copy opens it in the piano roll', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Copies');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Copies');
  const id = new URL(page.url()).pathname.split('/').pop();
  await page.getByRole('toolbar', { name: 'Piano roll tools' }).getByRole('button', { name: 'Preview notes' }).click();
  const grid = page.getByRole('grid', { name: 'Notes' });
  await grid.locator('[tabindex="0"]').focus();
  await page.keyboard.press('Enter');
  const midi = async () => Object.values((await saved(page, id))?.clips ?? {}).filter((c) => c.kind === 'midi').sort((a, b) => a.start - b.start);
  await expect.poll(async () => (await midi()).length).toBe(1);
  await clipRows(page).first().click();
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.getByRole('region', { name: 'Piano roll: Track 1' }).getByText('Track 1, bar 3 to bar 5', { exact: true })).toBeVisible();
  // The copy is selected, so the piano roll edits it and the original keeps one note.
  await grid.locator('[tabindex="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await midi()).map((c) => c.notes.length)).toEqual([1, 2]);
  await clipRows(page).first().click();
  await expect(page.getByRole('region', { name: 'Piano roll: Track 1' }).getByText('Track 1, bar 1 to bar 3', { exact: true })).toBeVisible();
});

test('adding clips: double-click an empty lane, the Add menu at the edit cursor, or drop audio files', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Adding');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Adding');
  const id = new URL(page.url()).pathname.split('/').pop();
  const clips = async () => Object.values((await saved(page, id))?.clips ?? {}).map((c) => [c.kind, c.start, c.kind === 'midi' ? c.length : c.sourceLength]).sort((a, b) => a[1] - b[1]);
  const roll = page.getByRole('region', { name: 'Piano roll: Track 1' });

  // Bar 3 starts at x = 256 (128 px per bar); the double-click snaps to the 1/4 grid.
  const at = await canvasPoint(page, 260, 0, 20);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(clips).toEqual([['midi', 7680, 3840]]);
  await expect(roll.getByText('Track 1, bar 3 to bar 4', { exact: true })).toBeVisible();

  // The Add menu adds at the edit cursor, moved to bar 1 by a click in the ruler.
  const ruler = await page.locator('section[aria-labelledby="studio-timeline"] canvas').boundingBox();
  await page.mouse.click(ruler.x + 1, ruler.y + RULER_H / 2);
  await (await menuItem(page, 'Add', 'MIDI clip on Track 1 at edit cursor')).click();
  await expect.poll(clips).toEqual([['midi', 0, 3840], ['midi', 7680, 3840]]);

  // Audio files dropped on the lanes go to a new audio track at the drop point (bar 2, x = 128).
  const drop = await canvasPoint(page, 128, 1, 20);
  const data = await page.evaluateHandle((bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'drop.wav', { type: 'audio/wav' }));
    return dt;
  }, [...wav(1)]);
  const lanes = page.locator('section[aria-labelledby="studio-timeline"] canvas');
  await lanes.dispatchEvent('dragover', { dataTransfer: data, clientX: drop.x, clientY: drop.y });
  await lanes.dispatchEvent('drop', { dataTransfer: data, clientX: drop.x, clientY: drop.y });
  await expect.poll(clips).toEqual([['midi', 0, 3840], ['audio', 3840, 48000], ['midi', 7680, 3840]]);
});
