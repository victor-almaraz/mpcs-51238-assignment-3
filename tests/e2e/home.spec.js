import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const DESCRIPTION = /W-Rack is a music sketchpad in your browser/;

const sectionHeadings = (page) => page.getByRole('main').getByRole('heading', { level: 2 });

const wrackKeys = (page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('w-rack:')));

test('first visit: description, then Create, Load and Examples; no Recent', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(DESCRIPTION)).toBeVisible();
  await expect(sectionHeadings(page)).toHaveText(['Create', 'Load', 'Examples']);
  await expect(page.getByRole('link', { name: 'New project' }).last()).toHaveAttribute('href', '/new');
  await expect(page.getByRole('button', { name: 'Open .wrack file' })).toBeVisible();
  for (const title of ['Beat', 'Ambient', 'Pluck melody']) {
    await expect(page.getByRole('button', { name: `Open ${title}` })).toBeVisible();
  }
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('an example opens as an unsaved copy, stopped, and saves nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page).toHaveURL(/\/projects\/prj_[A-Za-z0-9_-]{21}\?example=beat$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  await expect(page.getByText('Copy of example — saved on first edit')).toBeVisible();
  await expect(page.getByText('Stopped')).toBeVisible();
  await expect(page.getByText('Press Play to hear this example')).toBeVisible();
  const tracks = page.getByRole('region', { name: 'Tracks' }).getByRole('listitem');
  await expect(tracks).toHaveText([
    'Track 1: Drums, Drum machine',
    'Track 2: Bass, Subtractive synth',
    'Track 3: Lead stab, FM synth',
  ]);
  expect(await wrackKeys(page)).toEqual([]);

  await page.goto('/');
  await expect(page.getByText(DESCRIPTION)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent' })).toHaveCount(0);
});

test('every example opens', async ({ page }) => {
  for (const [title, firstTrack] of [
    ['Ambient', 'Track 1: Texture, Granular synth'],
    ['Pluck melody', 'Track 1: Pluck lead, Pluck synth'],
  ]) {
    await page.goto('/');
    await page.getByRole('button', { name: `Open ${title}` }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${title} (copy)`);
    await expect(page.getByRole('region', { name: 'Tracks' }).getByRole('listitem').first()).toHaveText(firstTrack);
  }
});

test('return visit: Recent comes first and Continue opens the project', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Kept song');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kept song');

  await page.goto('/');
  await expect(sectionHeadings(page)).toHaveText(['Recent', 'Create', 'Load', 'Examples']);
  await expect(page.getByText(DESCRIPTION)).toHaveCount(0);
  const recent = page.getByRole('region', { name: 'Recent' });
  await expect(recent.getByText('Kept song')).toBeVisible();
  await expect(recent.getByText(/^Edited /)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await recent.getByRole('link', { name: /^Continue Kept song/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kept song');
});

test('unreadable saved data shows the guarded message', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('w-rack:v1:index', '{broken'));
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('A saved project could not be read.');
  await expect(sectionHeadings(page)).toHaveText(['Create', 'Load', 'Examples']);
});
