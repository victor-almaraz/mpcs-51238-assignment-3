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
    const key = Object.keys(localStorage).find((k) => k.startsWith('wrack:v1:project:'));
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
  await tempo.fill('200');
  const read = () => page.evaluate(() => ({ tick: globalThis.__wrackEngine.positionTick(), at: performance.now() }));
  const before = await read();
  await tempo.press('Enter');
  await page.waitForTimeout(300);
  const after = await read();
  // Playback moves on by the elapsed time at 100 to 200 BPM (plus a beat of slack), never by a jump of bars.
  const most = ((after.at - before.at) / 1000) * (200 / 60) * PPQ + PPQ;
  expect(after.tick - before.tick).toBeGreaterThanOrEqual(0);
  expect(after.tick - before.tick).toBeLessThan(most);
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

test('a track renames by F2 on its row or a double-click on its header; F2 renames a clip too', async ({ page }) => {
  await openBeat(page);
  const row = tree(page).getByRole('row', { name: /^Track 2: Bass/ });
  await row.focus();
  await page.keyboard.press('F2');
  const field = page.getByRole('dialog', { name: 'Rename Bass' }).getByRole('textbox', { name: 'Track name' });
  await expect(field).toBeFocused();
  await field.fill('Sub bass');
  await field.press('Enter');
  await expect(tree(page).getByRole('row', { name: /^Track 2: Sub bass/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Renamed track to Sub bass' })).toHaveCount(1);

  await tree(page).getByRole('row', { name: /^Track 3: Lead stab/ }).dblclick({ position: { x: 60, y: 20 } });
  const second = page.getByRole('dialog', { name: 'Rename Lead stab' }).getByRole('textbox', { name: 'Track name' });
  await second.fill('');
  await second.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Rename Lead stab' })).toContainText('Enter a track name.');
  await page.keyboard.press('Escape');

  await clipRow(page, 'Drums').focus();
  await page.keyboard.press('F2');
  await expect(page.getByRole('dialog', { name: 'Rename Drums' }).getByRole('textbox', { name: 'Clip name' })).toBeFocused();
});

test('arming sends live notes only to armed tracks; with none armed they follow the selection', async ({ page }) => {
  // Record the track index of every live MIDI message sent to the engine.
  await page.addInitScript(() => {
    globalThis.__liveTracks = [];
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (msg, ...rest) {
      if (msg && msg.t === 'live' && msg.events?.[0] === 0x90) globalThis.__liveTracks.push(msg.track);
      return post.call(this, msg, ...rest);
    };
  });
  await openBeat(page);
  const sent = () => page.evaluate(() => globalThis.__liveTracks.splice(0));
  const play = async () => {
    await page.getByRole('heading', { level: 1 }).click();
    await page.keyboard.down('a');
    await page.keyboard.up('a');
  };
  const arm = (name) => tree(page).getByRole('button', { name: `Arm ${name} for live input` });

  // The first note opens the volume notice (a note released meanwhile is dropped); after Continue,
  // notes play on the selected track: track 1 while none is chosen.
  await play();
  await page.getByRole('alertdialog', { name: 'Volume notice' }).getByRole('button', { name: 'Continue' }).click();
  await sent();
  await play();
  await expect.poll(sent).toEqual([0]);
  await expect(page.getByText(/^Input: .+ \(selected\)$/)).toBeVisible();

  await arm('Bass').click();
  await arm('Lead stab').click();
  await expect(arm('Bass')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Input: Bass, Lead stab', { exact: true })).toBeVisible();
  await play();
  await expect.poll(async () => (await sent()).sort()).toEqual([1, 2]);

  // R on a focused track row toggles its arm.
  await tree(page).getByRole('row', { name: /^Track 3: Lead stab/ }).focus();
  await page.keyboard.press('r');
  await expect(arm('Lead stab')).toHaveAttribute('aria-pressed', 'false');
  await play();
  await expect.poll(sent).toEqual([1]);

  // The arm state is part of the working state.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(arm('Bass')).toHaveAttribute('aria-pressed', 'true');
});
