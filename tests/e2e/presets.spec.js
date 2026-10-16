import { expect, test } from '@playwright/test';

async function createProject(page, name) {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return new URL(page.url()).pathname.split('/').pop();
}

const saved = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);
const panel = (page) => page.getByRole('region', { name: 'Subtractive synth: Track 1' });

async function savePreset(page, name) {
  await panel(page).getByRole('button', { name: 'Save preset' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Subtractive synth preset' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('button', { name: 'Save preset' }).click();
  return dialog;
}

test('a preset saved in one project appears in another after reload and applies there', async ({ page }) => {
  await createProject(page, 'First');
  const cutoff = panel(page).getByRole('slider', { name: 'Cutoff' });
  await cutoff.focus();
  await page.keyboard.press('PageDown');
  const value = await cutoff.getAttribute('aria-valuetext');
  const dialog = await savePreset(page, 'Dark bass');
  await expect(dialog).toBeHidden();
  expect(JSON.stringify(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage))))).toContain('Dark bass');

  const id = await createProject(page, 'Second');
  await page.reload();
  const picker = panel(page).getByLabel('Preset', { exact: true });
  await expect(picker.locator('optgroup[label="My presets"] option')).toHaveText(['Dark bass']);
  await expect(picker.locator('optgroup[label="Built-in"] option')).toHaveText(['Default settings']);
  await picker.selectOption({ label: 'Dark bass' });
  await expect(panel(page).getByRole('slider', { name: 'Cutoff' })).toHaveAttribute('aria-valuetext', value);
  await expect.poll(async () => JSON.stringify(await saved(page, id))).not.toContain('Dark bass');
  await picker.selectOption({ label: 'Default settings' });
  await expect(panel(page).getByRole('slider', { name: 'Cutoff' })).not.toHaveAttribute('aria-valuetext', value);
});

test('the Save preset dialog keeps the name on error and shows the scope messages', async ({ page }) => {
  await createProject(page, 'Names');
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
    localStorage.setItem('w-rack:v1:presets', JSON.stringify({ schema: 1, presets }));
  });
  await createProject(page, 'Full');
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
