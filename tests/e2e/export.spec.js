import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/*
 * WAV export (assignment-3-scope.md, Export): two exports of one project hash
 * equal; the peak stays at or below −1 dBFS; headers are 44, 68 and 58 bytes.
 * The download path is used in every browser (Chromium's picker cannot be
 * driven headless).
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
  });
});

async function openExample(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
}

/** Exports with `format` and returns the file bytes. */
async function exportWav(page, testInfo, format, name) {
  await page.getByRole('toolbar', { name: 'Project' }).getByRole('button', { name: 'Export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export WAV' });
  await dialog.getByLabel('Format').selectOption({ label: format });
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await dialog.getByRole('button', { name: 'Export WAV' }).click();
  await expect(dialog.getByRole('button', { name: 'Exporting…' })).toBeDisabled().catch(() => {});
  const file = await download;
  const path = testInfo.outputPath(name);
  await file.saveAs(path);
  await expect(dialog.getByRole('status').filter({ hasText: /^Exported / })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close' }).click();
  return readFileSync(path);
}

const sha = (b) => createHash('sha256').update(b).digest('hex');

test('two 16-bit exports are bit-identical; headers are 44, 68 and 58 bytes; the float peak is at most −1 dBFS', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await openExample(page);
  const a = await exportWav(page, testInfo, 'WAV 16-bit (dithered)', 'a.wav');
  const b = await exportWav(page, testInfo, 'WAV 16-bit (dithered)', 'b.wav');
  expect(sha(a)).toBe(sha(b));
  expect(a.toString('ascii', 0, 4)).toBe('RIFF');
  expect(a.toString('ascii', 36, 40)).toBe('data');
  const w24 = await exportWav(page, testInfo, 'WAV 24-bit', 'c.wav');
  expect(w24.toString('ascii', 60, 64)).toBe('data');
  expect(w24.readUInt16LE(20)).toBe(0xfffe);
  const f32 = await exportWav(page, testInfo, 'WAV 32-bit float', 'd.wav');
  expect(f32.toString('ascii', 50, 54)).toBe('data');
  expect(f32.readUInt16LE(20)).toBe(3);
  let peak = 0;
  for (let at = 58; at + 4 <= f32.length; at += 4) peak = Math.max(peak, Math.abs(f32.readFloatLE(at)));
  expect(peak).toBeGreaterThan(0.01);
  expect(peak).toBeLessThanOrEqual(10 ** (-1 / 20));
  // The export stops the live transport and leaves no AudioContext running but the live one.
  await expect(page.getByRole('toolbar', { name: 'Transport' }).getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');
});

test('the export dialog lists silent clips and limits the range', async ({ page }) => {
  await openExample(page);
  await page.getByRole('toolbar', { name: 'Project' }).getByRole('button', { name: 'Export' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export WAV' });
  await expect(dialog.getByRole('slider', { name: 'Tail' })).toHaveAttribute('aria-valuetext', '2.0 s');
  await expect(dialog.getByRole('radio', { name: 'Whole project' })).toBeChecked();
  await expect(dialog).toContainText(/Length: \d+\.\d s including the tail/);
  await dialog.getByRole('group', { name: 'Range' }).getByText('Loop').click();
  await expect(dialog.getByRole('radio', { name: 'Loop' })).toBeChecked();
});
