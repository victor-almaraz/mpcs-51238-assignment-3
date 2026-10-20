import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { trackRow } from '../support/editor.js';

/*
 * Editor workspace (design-patterns.md): actionable empty timeline (ONB-01),
 * one action to a playable piano roll (ONB-02), track deletion, global
 * shortcuts, the snap toggle (ARR-04) and the shortcut overlay (HELP-02).
 */

async function createProject(page, name = 'Workspace') {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return new URL(page.url()).pathname.split('/').pop();
}

const saved = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `wrack:v1:project:${id}`);
const clipTools = (page) => page.getByRole('toolbar', { name: 'Clip commands' });
const transport = (page) => page.getByRole('toolbar', { name: 'Transport' });

test('an empty timeline offers its next steps; Add instrument track opens a two-bar clip in the piano roll', async ({ page }) => {
  const id = await createProject(page);
  // An empty track goes without a question.
  await trackRow(page, 'Track 1: Track 1').focus();
  await page.keyboard.press('Delete');
  const empty = page.getByRole('region', { name: 'No tracks' });
  await expect(empty).toContainText('No tracks.');
  await expect(empty.getByRole('button', { name: 'Add instrument track' })).toBeFocused();
  await expect(empty.getByRole('button', { name: 'Add audio file' })).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await empty.getByRole('button', { name: 'Add instrument track' }).click();
  await page.getByRole('menu', { name: 'Add instrument track' }).getByRole('menuitem', { name: 'Pluck synth track' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pluck synth track added, clip open in piano roll' })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: /^Piano roll: / })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Notes' }).locator(':focus')).toHaveCount(1);
  await expect.poll(async () => Object.values((await saved(page, id)).clips).map((c) => [c.kind, c.length])).toEqual([['midi', 2 * 4 * 960]]);

  // A track with clips asks first; Cancel keeps it.
  const row = page.getByRole('treegrid', { name: 'Tracks and clips' }).locator('[role="row"][aria-level="1"]').first();
  await row.focus();
  await page.keyboard.press('Delete');
  const confirm = page.getByRole('dialog', { name: /^Delete .+\?$/ });
  await expect(confirm).toContainText('Undo (Ctrl/Cmd+Z) restores them.');
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(row).toBeVisible();
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete track' }).click();
  await expect(empty).toBeVisible();
  await expect.poll(async () => (await saved(page, id)).trackOrder).toEqual([]);
});

test('L, N, C, + and − work anywhere, also while keyboard playing is on; G and K stay notes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  const loop = transport(page).getByRole('button', { name: 'Loop' });
  const metronome = transport(page).getByRole('button', { name: 'Metronome' });
  const snap = clipTools(page).getByRole('button', { name: 'Snap', exact: true });
  const grid = clipTools(page).getByLabel('Grid', { exact: true });
  await page.getByRole('heading', { level: 1 }).click();

  await page.keyboard.press('l');
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('l');
  await expect(loop).toHaveAttribute('aria-pressed', 'false');

  // Keyboard playing is on by default; the snap and metronome keys are not note keys.
  await expect(page.getByRole('button', { name: 'Play with keyboard' })).toHaveAttribute('aria-pressed', 'true');
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('n');
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status').filter({ hasText: 'Snap off' })).toHaveCount(1);
  await page.keyboard.press('n');
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('c');
  await expect(metronome).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('c');
  await expect(metronome).toHaveAttribute('aria-pressed', 'false');

  // G is a note: it asks for the volume notice and changes no setting.
  await page.keyboard.press('g');
  await page.getByRole('alertdialog', { name: 'Volume notice' }).getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('k');
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await expect(metronome).toHaveAttribute('aria-pressed', 'false');

  await expect(grid).toHaveValue('1');
  await page.keyboard.press('+');
  await expect(grid).toHaveValue('0.5');
  await expect(page.getByRole('status').filter({ hasText: 'Snap: 1/8' })).toHaveCount(1);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect(grid).toHaveValue('bar');

  // Typing in a field never runs a shortcut.
  await transport(page).getByLabel('Tempo (BPM)').focus();
  await page.keyboard.press('l');
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
});

test('? lists the shortcuts by group and returns focus on close', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  const loop = transport(page).getByRole('button', { name: 'Loop' });
  await loop.focus();
  await page.keyboard.press('?');
  const overlay = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(overlay).toBeVisible();
  for (const group of ['Transport', 'Timeline', 'Project', 'Tracks and clips', 'Piano roll', 'Keyboard notes']) {
    await expect(overlay.getByRole('heading', { name: group, exact: true })).toBeVisible();
  }
  await expect(overlay.getByRole('definition').filter({ hasText: /^Turn loop on$/ })).toHaveCount(1);
  await expect(overlay.getByRole('button', { name: 'Close' })).toBeFocused();
  const axe = await new AxeBuilder({ page }).include('dialog[open]').analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expect(loop).toBeFocused();
  // Escape closed the overlay only; the transport is untouched.
  await expect(transport(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('the panels collapse to their tabs and stay collapsed after a reload', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Folded');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Folded');
  const toggle = page.getByRole('button', { name: 'Panels', exact: true });
  const panel = page.getByRole('tabpanel');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  const before = (await page.getByRole('region', { name: 'Timeline' }).boundingBox()).height;

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  await expect(page.getByRole('separator', { name: 'Resize the panels' })).toBeHidden();
  expect((await page.getByRole('region', { name: 'Timeline' }).boundingBox()).height).toBeGreaterThan(before + 100);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Panels', exact: true })).toHaveAttribute('aria-expanded', 'false');
  // A click on a tab expands; a click on the open tab collapses again.
  await page.getByRole('tab', { name: 'Mixer' }).click();
  await expect(page.getByRole('tab', { name: 'Mixer' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toBeVisible();
  await page.getByRole('tab', { name: 'Mixer' }).click();
  await expect(page.getByRole('tabpanel')).toBeHidden();
  await page.getByRole('tab', { name: 'Editor' }).click();
  await expect(page.getByRole('region', { name: 'Piano roll: Track 1' })).toBeVisible();
});

test('icon controls name themselves and show a tooltip with their shortcut', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  const loop = transport(page).getByRole('button', { name: 'Loop' });
  await expect(loop).toHaveAttribute('data-tip', 'Loop (L)');
  // Keyboard focus (focus-visible) shows the tooltip at once.
  await transport(page).getByRole('button', { name: 'Metronome' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(loop).toBeFocused();
  await expect(page.getByText('Loop (L)', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Loop (L)', { exact: true })).toHaveCount(0);
});

test('opening a knob value field and leaving it unchanged keeps the exact value', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('tab', { name: 'Devices' }).click();
  const panel = page.getByRole('region', { name: /^Subtractive synth: / });
  const cutoff = panel.getByRole('slider', { name: 'Cutoff' });
  await cutoff.focus();
  // A few steps up: a value between two readout roundings ("2.1 kHz" is not exactly 2100 Hz).
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  const before = await cutoff.inputValue();
  const shown = await cutoff.getAttribute('aria-valuetext');
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('textbox', { name: 'Cutoff value' })).toHaveValue(shown);
  await page.keyboard.press('Tab'); // leaves the field without typing
  await expect(panel.getByRole('textbox', { name: 'Cutoff value' })).toHaveCount(0);
  expect(await cutoff.inputValue()).toBe(before);
});

test('knobs take a typed value with units, follow a vertical drag and reset on double-click', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Knobs');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Knobs');
  await page.getByRole('tab', { name: 'Devices' }).click();
  const panel = page.getByRole('region', { name: 'Subtractive synth: Track 1' });
  await expect(panel.getByRole('group', { name: 'Filter' })).toBeVisible();
  const cutoff = panel.getByRole('slider', { name: 'Cutoff' });
  await cutoff.focus();
  await page.keyboard.press('Enter');
  const field = panel.getByRole('textbox', { name: 'Cutoff value' });
  await field.fill('1.5 kHz');
  await page.keyboard.press('Enter');
  await expect(cutoff).toHaveAttribute('aria-valuetext', '1.5 kHz');
  await expect(cutoff).toBeFocused();

  const before = Number(await cutoff.inputValue());
  const knob = cutoff.locator('xpath=..');
  const box = await knob.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  expect(Number(await cutoff.inputValue())).toBeGreaterThan(before);
  await knob.dblclick();
  await expect(cutoff).toHaveAttribute('aria-valuetext', '2.0 kHz');
});

test('the mixer has vertical strips: pan knob, fader and M and S per track', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  await page.getByRole('tab', { name: 'Mixer' }).click();
  const mixer = page.getByRole('region', { name: 'Mixer' });
  const fader = mixer.getByRole('slider', { name: 'Bass volume' });
  await expect(fader).toHaveAttribute('aria-orientation', 'vertical');
  await expect(mixer.getByRole('button', { name: 'Mute Bass' })).toHaveText('M');
  await expect(mixer.getByRole('button', { name: 'Solo Bass' })).toHaveText('S');
  await fader.focus();
  await page.keyboard.press('PageDown');
  await expect(fader).toHaveAttribute('aria-valuetext', '−6.6 dB');
  // The pan knob sits above the fader in each strip.
  const pan = await mixer.getByRole('slider', { name: 'Bass pan' }).locator('xpath=..').boundingBox();
  const cap = await fader.locator('xpath=..').boundingBox();
  expect(pan.y).toBeLessThan(cap.y);
  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="studio-mixer"]').analyze();
  expect(axe.violations).toEqual([]);
});
