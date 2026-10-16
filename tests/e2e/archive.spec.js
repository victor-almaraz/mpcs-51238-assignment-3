import { expect, test } from '@playwright/test';

/** A 16-bit mono PCM WAV of a 440 Hz sine, `seconds` long at 48 kHz. */
function wav(seconds = 1) {
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
  for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + 2 * i);
  return b;
}

const clipRows = (page) => page.getByRole('treegrid', { name: 'Tracks and clips' }).locator('[role="row"][aria-level="2"]');
const projectBar = (page) => page.getByRole('toolbar', { name: 'Project' });

/** Creates a project holding one imported WAV and saves it as a .wrack download; returns the file path. */
async function savedArchive(page, testInfo) {
  // The download path is the one every browser has; Chromium's file picker cannot be driven headless.
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
  });
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Carried');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Carried');
  await page.locator('input[type="file"][accept^="audio"]').first().setInputFiles([{ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav() }]);
  await expect(clipRows(page)).toHaveCount(1);
  await expect(projectBar(page)).toContainText('Not saved to file');
  const download = page.waitForEvent('download');
  await projectBar(page).getByRole('button', { name: 'Save .wrack file' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Carried.wrack');
  const path = testInfo.outputPath('Carried.wrack');
  await file.saveAs(path);
  await expect(projectBar(page)).toContainText('Saved to file');
  return path;
}

test('a saved .wrack file opens on another device as a project with its audio', async ({ page, browser }, testInfo) => {
  const path = await savedArchive(page, testInfo);
  const other = await browser.newContext();
  const fresh = await other.newPage();
  const navigations = [];
  fresh.on('framenavigated', (f) => f === fresh.mainFrame() && navigations.push(f.url()));
  await fresh.goto('/');
  await fresh.locator('input[type="file"][accept=".wrack,application/zip"]').setInputFiles(path);
  await expect(fresh.getByRole('heading', { level: 1 })).toHaveText('Carried');
  // The editor opens by client navigation, so audio decoded from the file stays in memory.
  expect(navigations.filter((u) => u.includes('/projects/')).length).toBeLessThanOrEqual(1);
  // Decoding the carried audio can take a few seconds in WebKit.
  await expect(clipRows(fresh)).toHaveText([/^Clip: tone, bar 1 to bar 1 beat 3, (Saved on this device|Session only)$/], { timeout: 20_000 });
  await other.close();
});

test('opening a file for a project already on the device offers Restore audio or Replace project', async ({ page }, testInfo) => {
  const path = await savedArchive(page, testInfo);
  await page.goto('/');
  await page.locator('input[type="file"][accept=".wrack,application/zip"]').setInputFiles(path);
  const dialog = page.getByRole('dialog', { name: 'Carried is already on this device' });
  await expect(dialog.getByRole('button', { name: 'Restore audio' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Restore audio' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Carried');
});

test('a damaged file imports nothing and lists its errors', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"][accept=".wrack,application/zip"]').setInputFiles([
    { name: 'broken.wrack', mimeType: 'application/zip', buffer: Buffer.from('this is not a zip archive') },
  ]);
  const alert = page.getByRole('region', { name: 'Load' }).getByRole('alert');
  await expect(alert).toContainText('Nothing was imported');
  await expect(alert.getByRole('listitem')).not.toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});
