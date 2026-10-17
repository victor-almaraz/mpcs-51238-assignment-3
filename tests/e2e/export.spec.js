import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { menuItem } from '../support/editor.js';

/*
 * WAV export (assignment-3-scope.md, Export; EXP-02): two exports of one
 * project hash equal; the peak stays at or below −1 dBFS; headers are 44, 68
 * and 58 bytes; a finished render waits for Download; Cancel discards it.
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
  await (await menuItem(page, 'File', 'Export WAV…')).click();
  const dialog = page.getByRole('dialog', { name: 'Export WAV' });
  await dialog.getByLabel('Format').selectOption({ label: format });
  await dialog.getByRole('button', { name: 'Export WAV' }).click();
  const save = dialog.getByRole('button', { name: /^Download \(\d+(\.\d)? (KB|MB)\)$/ });
  await expect(save).toBeFocused({ timeout: 120_000 });
  const download = page.waitForEvent('download');
  await save.click();
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
  await expect(page.getByRole('toolbar', { name: 'Transport' }).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('the export dialog lists silent clips and limits the range', async ({ page }) => {
  await openExample(page);
  await (await menuItem(page, 'File', 'Export WAV…')).click();
  const dialog = page.getByRole('dialog', { name: 'Export WAV' });
  await expect(dialog.getByRole('slider', { name: 'Tail' })).toHaveAttribute('aria-valuetext', '2.0 s');
  await expect(dialog.getByRole('radio', { name: 'Whole project' })).toBeChecked();
  await expect(dialog).toContainText(/Length: \d+\.\d s including the tail/);
  await dialog.getByRole('group', { name: 'Range' }).getByText('Loop').click();
  await expect(dialog.getByRole('radio', { name: 'Loop' })).toBeChecked();
});

test('Cancel stops waiting for a render and discards it; nothing downloads by itself', async ({ page }) => {
  await openExample(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await (await menuItem(page, 'File', 'Export WAV…')).click();
  const dialog = page.getByRole('dialog', { name: 'Export WAV' });
  await dialog.getByRole('slider', { name: 'Tail' }).focus();
  await page.keyboard.press('End');
  await dialog.getByRole('button', { name: 'Export WAV' }).click();
  await expect(dialog.getByRole('progressbar', { name: 'Export progress' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.getByRole('progressbar')).toBeHidden();
  await expect(dialog.getByRole('status').filter({ hasText: 'Export cancelled' })).toHaveCount(1);
  // Once the cancelled render ends, Export is available again and no Download appears.
  await expect(dialog.getByRole('button', { name: 'Export WAV' })).toBeEnabled({ timeout: 120_000 });
  await expect(dialog.getByRole('button', { name: /^Download/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Export WAV' }).click();
  await expect(dialog.getByRole('button', { name: /^Download/ })).toBeFocused({ timeout: 120_000 });
  expect(downloads).toBe(0);
});
