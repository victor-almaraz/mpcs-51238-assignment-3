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

const saved = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);
const clipTools = (page) => page.getByRole('toolbar', { name: 'Clip commands' });
const transport = (page) => page.getByRole('toolbar', { name: 'Transport' });

test('an empty timeline offers its next steps; Add instrument track opens a four-bar clip in the piano roll', async ({ page }) => {
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

  await clipTools(page).getByLabel('Instrument').selectOption({ label: 'Pluck synth' });
  await empty.getByRole('button', { name: 'Add instrument track' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pluck synth track added, clip open in piano roll' })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: /^Piano roll: / })).toBeVisible();
  await expect(page.getByRole('grid', { name: 'Notes' }).locator(':focus')).toHaveCount(1);
  await expect.poll(async () => Object.values((await saved(page, id)).clips).map((c) => [c.kind, c.length])).toEqual([['midi', 4 * 4 * 960]]);

  // A track with clips asks first; Cancel keeps it.
  const row = page.getByRole('treegrid', { name: 'Tracks and clips' }).locator('[role="row"][aria-level="1"]').first();
  await row.focus();
  await page.keyboard.press('Delete');
  const confirm = page.getByRole('dialog', { name: /^Delete .+\?$/ });
  await expect(confirm).toContainText('This cannot be undone.');
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press('Delete');
  await confirm.getByRole('button', { name: 'Delete track' }).click();
  await expect(empty).toBeVisible();
  await expect.poll(async () => (await saved(page, id)).trackOrder).toEqual([]);
});

test('L, G, + and − work anywhere; G and K play notes while keyboard playing is on', async ({ page }) => {
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

  // Keyboard playing is on by default: G and K are notes, and the first note asks for the volume notice.
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('g');
  await page.getByRole('alertdialog', { name: 'Volume notice' }).getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('k');
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await expect(metronome).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Play with keyboard' }).click();
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('g');
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status').filter({ hasText: 'Snap off' })).toHaveCount(1);
  await page.keyboard.press('g');
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('k');
  await expect(metronome).toHaveAttribute('aria-pressed', 'true');

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
  await expect(transport(page).getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');
});
