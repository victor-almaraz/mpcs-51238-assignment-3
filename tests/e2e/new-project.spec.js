import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const NAME_EMPTY = 'Enter a project name.';
const NAME_TOO_LONG = 'Use 60 characters or fewer.';
const TEMPO_INVALID = 'Enter a tempo between 40 and 240.';

async function form(page) {
  await page.goto('/new');
  const name = page.getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveValue('Untitled project 1');
  return {
    name,
    tempo: page.getByRole('textbox', { name: 'Tempo (BPM)' }),
    signature: page.getByRole('combobox', { name: 'Time signature' }),
    submit: page.getByRole('button', { name: 'Create project' }),
  };
}

/** Asserts `field` shows `message` below it, linked and marked invalid. */
async function expectError(page, field, message) {
  const error = page.getByText(message);
  await expect(error).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  const errorId = await error.locator('xpath=..').getAttribute('id');
  await expect(field).toHaveAttribute('aria-describedby', new RegExp(`\\b${errorId}\\b`));
}

test('defaults: prefilled name, tempo 120, 4/4', async ({ page }) => {
  const f = await form(page);
  await expect(f.tempo).toHaveValue('120');
  await expect(f.signature).toHaveValue('4/4');
  await expect(f.signature.locator('option')).toHaveText(['2/4', '3/4', '4/4', '6/8']);
});

test('an empty name shows its error, keeps values and focuses the field', async ({ page }) => {
  const f = await form(page);
  await f.name.fill('   ');
  await f.tempo.fill('96');
  await f.submit.click();
  await expectError(page, f.name, NAME_EMPTY);
  await expect(f.name).toBeFocused();
  await expect(f.name).toHaveValue('   ');
  await expect(f.tempo).toHaveValue('96');
  await expect(page).toHaveURL(/\/new$/);
});

test('a 61-character name is rejected and kept', async ({ page }) => {
  const f = await form(page);
  const long = 'x'.repeat(61);
  await f.name.fill(long);
  await f.submit.click();
  await expectError(page, f.name, NAME_TOO_LONG);
  await expect(f.name).toHaveValue(long);
});

for (const bad of ['39', '241', 'abc']) {
  test(`tempo ${bad} is rejected and kept`, async ({ page }) => {
    const f = await form(page);
    await f.tempo.fill(bad);
    await f.submit.click();
    await expectError(page, f.tempo, TEMPO_INVALID);
    await expect(f.tempo).toBeFocused();
    await expect(f.tempo).toHaveValue(bad);
    await expect(f.name).not.toHaveAttribute('aria-invalid', 'true');
  });
}

test('with two errors, focus moves to the first invalid field', async ({ page }) => {
  const f = await form(page);
  await f.name.fill('');
  await f.tempo.fill('abc');
  await f.submit.click();
  await expectError(page, f.name, NAME_EMPTY);
  await expectError(page, f.tempo, TEMPO_INVALID);
  await expect(f.name).toBeFocused();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('an edited field validates on blur; an untouched field does not', async ({ page }) => {
  const f = await form(page);
  await f.name.focus();
  await f.tempo.focus();
  await expect(f.name).not.toHaveAttribute('aria-invalid', 'true');
  await f.tempo.fill('300');
  await f.signature.focus();
  await expectError(page, f.tempo, TEMPO_INVALID);
  await f.tempo.fill('100');
  await f.signature.focus();
  await expect(page.getByText(TEMPO_INVALID)).toHaveCount(0);
  await expect(f.tempo).not.toHaveAttribute('aria-invalid', 'true');
});

test('a valid submit saves the project and opens it with one empty instrument track', async ({ page }) => {
  const f = await form(page);
  await f.name.fill('  First song  ');
  await f.tempo.fill('96');
  await f.signature.selectOption('3/4');
  await f.submit.click();
  await expect(page).toHaveURL(/\/projects\/prj_[A-Za-z0-9_-]{21}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('First song');
  await expect(page.getByText('96 BPM · 3/4')).toBeVisible();
  const tracks = page.getByRole('treegrid', { name: 'Tracks and clips' }).locator('[role="row"][aria-level="1"]');
  await expect(tracks).toHaveCount(1);
  await expect(tracks.first()).toHaveAccessibleName(/^Track 1: Track 1, Subtractive synth/);
  await expect(page.getByText('Press a key or click the grid to add a note')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add audio file' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keyboard map' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('First song');

  await page.goto('/new');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Untitled project 1');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Untitled project 1');
  await page.goto('/new');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Untitled project 2');
});

test('a full storage keeps the form values and shows the storage message', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function setItem() {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  const f = await form(page);
  await f.name.fill('Too big');
  await f.submit.click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    "This device's browser storage is full. Save a .wrack file, then delete unused projects.",
  );
  await expect(f.name).toHaveValue('Too big');
  await expect(page).toHaveURL(/\/new$/);
});
