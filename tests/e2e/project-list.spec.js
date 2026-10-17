import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/*
 * Project lists (RET-01): each entry shows the relative and absolute edit
 * date, tempo, time signature, track count and an origin badge; /projects
 * renames and duplicates.
 */

async function createProject(page, name) {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

test('Recent shows metadata and the origin of a saved example copy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  // The first edit saves the copy.
  await page.getByRole('toolbar', { name: 'Transport' }).getByLabel('Tempo (BPM)').fill('110');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.goto('/');
  const recent = page.getByRole('region', { name: 'Recent' });
  const item = recent.getByRole('listitem').first();
  await expect(item).toContainText('From example: Beat');
  await expect(item).toContainText(/Edited (just now|\d+ seconds? ago) \(.+\d{4}.+\) · 110 BPM · 4\/4 · 3 tracks/);
  const link = recent.getByRole('link', { name: 'Continue Beat (copy)' });
  await expect(link).toHaveAccessibleDescription(/^From example: Beat Edited .+ · 110 BPM · 4\/4 · 3 tracks$/);
});

test('Projects renames and duplicates a project, named in each action', async ({ page }) => {
  await createProject(page, 'Draft');
  await page.goto('/projects');
  const list = page.getByRole('list', { name: 'Saved projects' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('120 BPM · 4/4 · 1 track');

  await list.getByRole('button', { name: 'Rename Draft' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename Draft' });
  const field = dialog.getByRole('textbox', { name: 'Name' });
  await expect(field).toBeFocused();
  await field.fill('   ');
  await dialog.getByRole('button', { name: 'Rename project' }).click();
  await expect(field).toHaveAccessibleDescription('Enter a project name.');
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await field.fill('Final');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(list.getByRole('button', { name: 'Rename Final' })).toBeFocused();

  await list.getByRole('button', { name: 'Duplicate Final' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('link', { name: 'Open Final (copy)' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Duplicated Final as Final (copy)' })).toHaveCount(1);
  await list.getByRole('link', { name: 'Open Final (copy)' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Final (copy)');
});
