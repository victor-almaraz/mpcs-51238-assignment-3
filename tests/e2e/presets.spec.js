import { expect, test } from '@playwright/test';
import { openTab } from '../support/editor.js';

async function createProject(page, name) {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return new URL(page.url()).pathname.split('/').pop();
}

const saved = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `wrack:v1:project:${id}`);
const panel = (page) => page.getByRole('region', { name: 'Subtractive synth: Track 1' });

/** Opens the Devices tab, where the instrument panel lives. */
const devices = (page) => openTab(page, 'Devices');

async function savePreset(page, name) {
  await panel(page).getByRole('button', { name: 'Save preset' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Subtractive synth preset' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('button', { name: 'Save preset' }).click();
  return dialog;
}

test('a preset saved in one project appears in another after reload and applies there', async ({ page }) => {
  await createProject(page, 'First');
  await devices(page);
  const cutoff = panel(page).getByRole('slider', { name: 'Cutoff' });
  await cutoff.focus();
  await page.keyboard.press('PageDown');
  const value = await cutoff.getAttribute('aria-valuetext');
  const dialog = await savePreset(page, 'Dark bass');
  await expect(dialog).toBeHidden();
  expect(JSON.stringify(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))))).toContain('Dark bass');

  const id = await createProject(page, 'Second');
  await page.reload();
  await devices(page);
  // LIB-01: grouped options; arrows move without applying; Enter or a click applies.
  const picker = panel(page).getByRole('combobox', { name: 'Preset' });
  await picker.click();
  const list = panel(page).getByRole('listbox', { name: 'Preset list' });
  await expect(list.getByRole('group', { name: 'My presets' }).getByRole('option')).toHaveText(['Dark bass']);
  await expect(list.getByRole('group', { name: 'Built-in' }).getByRole('option')).toHaveText(['Default settings']);
  await page.keyboard.press('ArrowDown');
  await expect(picker).toHaveAttribute('aria-activedescendant', /.+/);
  await expect(panel(page).getByRole('slider', { name: 'Cutoff' })).not.toHaveAttribute('aria-valuetext', value);
  await expect(panel(page).getByRole('button', { name: 'Preview Default settings' })).toBeVisible();
  await picker.fill('dark');
  await expect(list.getByRole('option')).toHaveText(['Dark bass']);
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(panel(page).getByRole('slider', { name: 'Cutoff' })).toHaveAttribute('aria-valuetext', value);
  await expect.poll(async () => JSON.stringify(await saved(page, id))).not.toContain('Dark bass');
  await picker.click();
  await list.getByRole('option', { name: 'Default settings' }).click();
  await expect(panel(page).getByRole('slider', { name: 'Cutoff' })).not.toHaveAttribute('aria-valuetext', value);
});

test('the Save preset dialog keeps the name on error and shows the scope messages', async ({ page }) => {
  await createProject(page, 'Names');
  await devices(page);
  await savePreset(page, 'Lead');
  const dialog = await savePreset(page, ' lead ');
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue(' lead ');
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveAccessibleDescription(
    /A preset with this name already exists for Subtractive synth\. Choose another name\./,
  );
  await dialog.getByRole('textbox', { name: 'Name' }).fill('');
  await dialog.getByRole('button', { name: 'Save preset' }).click();
  await expect(dialog).toContainText('Enter a preset name.');
  await dialog.getByRole('textbox', { name: 'Name' }).fill('x'.repeat(41));
  await dialog.getByRole('button', { name: 'Save preset' }).click();
  await expect(dialog).toContainText('Use 40 characters or fewer.');
});

test('the 201st preset is refused with the library message; /settings renames and deletes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const presets = Array.from({ length: 200 }, (_, i) => ({ id: `pst_${i}`, name: `Preset ${i}`, kind: 'instrument', type: 'fm', params: {} }));
    localStorage.setItem('wrack:v1:presets', JSON.stringify({ schema: 1, presets }));
  });
  await createProject(page, 'Full');
  await devices(page);
  const dialog = await savePreset(page, 'One too many');
  await expect(dialog.getByRole('alert')).toHaveText('The preset library is full. Delete a preset in Settings to save a new one.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/settings');
  const list = page.getByRole('region', { name: 'Presets', exact: true });
  await expect(list).toContainText('200 of 200 presets');
  await list.getByRole('button', { name: 'Rename Preset 0' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename Preset 0' });
  await rename.getByRole('textbox', { name: 'Name' }).fill('Preset 1');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(rename).toContainText('A preset with this name already exists for FM synth. Choose another name.');
  await rename.getByRole('textbox', { name: 'Name' }).fill('Bell');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(list.getByRole('button', { name: 'Rename Bell' })).toBeVisible();
  await list.getByRole('button', { name: 'Delete Bell' }).click();
  await page.getByRole('dialog', { name: 'Delete Bell?' }).getByRole('button', { name: 'Delete preset' }).click();
  await expect(list).toContainText('199 of 200 presets');
});

test('Preview plays the highlighted preset for one bar and leaves the device unchanged', async ({ page }) => {
  const id = await createProject(page, 'Audition');
  await devices(page);
  const cutoff = panel(page).getByRole('slider', { name: 'Cutoff' });
  await cutoff.focus();
  await page.keyboard.press('PageDown');
  const value = await cutoff.getAttribute('aria-valuetext');
  const picker = panel(page).getByRole('combobox', { name: 'Preset' });
  await picker.click();
  await page.keyboard.press('ArrowDown');
  const preview = panel(page).getByRole('button', { name: 'Preview Default settings' });
  await preview.click();
  await page.getByRole('alertdialog', { name: 'Volume notice' }).getByRole('button', { name: 'Continue' }).click();
  await expect(preview).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => globalThis.__wrackEngine.getMasterLevel().peakL), { timeout: 5000 }).toBeGreaterThan(0.0005);
  // The bar ends by itself; the device keeps its settings.
  await expect(preview).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
  await expect(cutoff).toHaveAttribute('aria-valuetext', value);
  await expect.poll(async () => Object.values((await saved(page, id)).devices).some((d) => d.preset)).toBe(false);
});
