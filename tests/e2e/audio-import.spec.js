import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';

/** A 16-bit PCM WAV of `seconds` of a `freq` Hz sine at `rate`, `channels` channels. */
function wav({ seconds = 1, freq = 440, rate = 48000, channels = 1 } = {}) {
  const frames = Math.round(seconds * rate);
  const data = frames * channels * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * freq * i) / rate));
    for (let c = 0; c < channels; c++) b.writeInt16LE(v, 44 + 2 * (i * channels + c));
  }
  return b;
}

const FIXTURES = [
  { name: 'tone-a.wav', mimeType: 'audio/wav', buffer: wav({ seconds: 2, freq: 440 }) },
  { name: 'tone-b.wav', mimeType: 'audio/wav', buffer: wav({ seconds: 1, freq: 660, channels: 2 }) },
];

/*
 * Pages whose IndexedDB keeps Blobs. Playwright's WebKit contexts are
 * ephemeral, like Safari private windows, and keep none (imports there are
 * correctly session-only), so WebKit runs these tests in a persistent profile
 * under the test output.
 */
const test = base.extend({
  page: async ({ browserName, page, playwright }, provide, testInfo) => {
    if (browserName !== 'webkit') {
      await provide(page);
      return;
    }
    const context = await playwright.webkit.launchPersistentContext(testInfo.outputPath('profile'), {
      baseURL: testInfo.project.use.baseURL,
    });
    await provide(context.pages()[0] ?? (await context.newPage()));
    await context.close();
  },
});

async function createProject(page, name = 'Audio') {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return new URL(page.url()).pathname.split('/').pop();
}

const tree = (page) => page.getByRole('treegrid', { name: 'Tracks and clips' });
const clipRows = (page) => tree(page).locator('[role="row"][aria-level="2"]');
const results = (page) => page.getByRole('status', { name: 'Import results' });
const saved = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);

/** sourceIds stored in IndexedDB. */
const storedIds = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('w-rack', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('sources', { keyPath: 'sourceId' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('sources', 'readonly').objectStore('sources').getAllKeys();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );

async function importFixtures(page, files = FIXTURES) {
  await page.locator('input[type="file"]').setInputFiles(files);
  for (const f of files) await expect(results(page)).toContainText(`Added ${f.name}.`);
}

test('two WAV files import onto a new audio track, persist in IndexedDB and reload from it', async ({ page }) => {
  const id = await createProject(page);
  await importFixtures(page);
  await expect(results(page)).toContainText('Added tone-a.wav. Saved on this device.');
  await expect(results(page)).toContainText('Added tone-b.wav. Saved on this device.');
  await expect(tree(page).getByRole('row', { name: /^Track 2: tone-a, Audio, 2 clips/ })).toBeVisible();
  await expect(clipRows(page)).toHaveText([
    'Clip: tone-a, bar 1 to bar 2, Saved on this device',
    'Clip: tone-b, bar 2 to bar 2 beat 3, Saved on this device',
  ]);
  await expect.poll(async () => Object.keys((await saved(page, id)).sources).length).toBe(2);
  const doc = await saved(page, id);
  expect(doc.audioRate).toBeGreaterThan(0);
  expect((await storedIds(page)).sort()).toEqual(Object.keys(doc.sources).sort());

  await page.reload();
  await expect(clipRows(page)).toHaveText([
    'Clip: tone-a, bar 1 to bar 2, Saved on this device',
    'Clip: tone-b, bar 2 to bar 2 beat 3, Saved on this device',
  ]);
  await expect(page.getByRole('button', { name: 'Open .wrack file to restore audio' })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="studio-timeline"]').analyze();
  expect(axe.violations).toEqual([]);
});

test('an import that fails the capacity check is session-only with the scope message', async ({ page }) => {
  await page.addInitScript(() => {
    StorageManager.prototype.estimate = async () => ({ usage: 950, quota: 1000 });
  });
  await createProject(page, 'Full disk');
  await importFixtures(page, [FIXTURES[0]]);
  await expect(results(page)).toContainText('This browser could not store tone-a.wav. Save a .wrack file to keep this audio.');
  await expect(clipRows(page)).toHaveText(['Clip: tone-a, bar 1 to bar 2, Session only']);
  expect(await storedIds(page)).toEqual([]);
});

test('an undecodable file reports its error and the next file still imports', async ({ page }) => {
  await createProject(page, 'Mixed');
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'notes.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio at all') },
    FIXTURES[0],
  ]);
  await expect(results(page)).toContainText('Could not decode notes.wav. Supported formats: WAV, MP3, M4A/AAC, FLAC, OGG.');
  await expect(results(page)).toContainText('Added tone-a.wav.');
  await expect(clipRows(page)).toHaveCount(1);
});

test('keyboard only: split at the edit cursor, join, move, duplicate and delete clips', async ({ page }) => {
  const id = await createProject(page, 'Edit');
  await importFixtures(page, [FIXTURES[0]]);
  const clip = clipRows(page).first();
  await clip.click();
  await expect(clip).toHaveAttribute('aria-selected', 'true');
  // The edit cursor moves by a beat; split two beats in.
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await expect(page.getByText('Edit cursor: bar 1 beat 3')).toBeVisible();
  await page.keyboard.press('s');
  await expect(clipRows(page)).toHaveText([
    'Clip: tone-a, bar 1 to bar 1 beat 3, Saved on this device',
    'Clip: tone-a, bar 1 beat 3 to bar 2, Saved on this device',
  ]);
  await page.keyboard.press('j');
  await expect(clipRows(page)).toHaveText(['Clip: tone-a, bar 1 to bar 2, Saved on this device']);
  await expect.poll(async () => Object.keys((await saved(page, id)).clips).length).toBe(1);

  await clipRows(page).first().focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(clipRows(page)).toHaveText(['Clip: tone-a, bar 1 beat 2 to bar 2 beat 2, Saved on this device']);
  await page.keyboard.press('Control+d');
  await expect(clipRows(page)).toHaveCount(2);
  await expect(clipRows(page).nth(1)).toHaveText('Clip: tone-a, bar 2 beat 2 to bar 3 beat 2, Saved on this device');
  await page.keyboard.press('Delete');
  await expect(clipRows(page)).toHaveCount(1);
  await page.keyboard.press('Shift+Alt+ArrowLeft');
  await expect(clipRows(page)).toHaveText(['Clip: tone-a, bar 1 beat 2 to bar 2, Saved on this device']);
});

test('join explains why it is unavailable', async ({ page }) => {
  await createProject(page, 'No join');
  await importFixtures(page, [FIXTURES[0]]);
  await clipRows(page).first().click();
  await expect(page.getByText('Join: No clip touches this clip.')).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.getByRole('status').filter({ hasText: 'Cannot join: No clip touches this clip.' })).toHaveCount(1);
});

test('clip properties edit gain, fades and the envelope', async ({ page }) => {
  const id = await createProject(page, 'Props');
  await importFixtures(page, [FIXTURES[0]]);
  await clipRows(page).first().click();
  const props = page.getByRole('region', { name: 'Clip properties: tone-a' });
  await expect(props).toContainText('Saved on this device');
  await props.getByRole('slider', { name: 'Clip gain' }).fill('-6');
  await props.getByRole('slider', { name: 'Fade-in length' }).fill('250');
  await props.getByLabel('Fade-out curve').selectOption('equalPower');
  await props.getByRole('button', { name: 'Add point at edit cursor' }).click();
  await props.getByRole('textbox', { name: 'Clip name' }).fill('Lead take');
  await props.getByRole('textbox', { name: 'Clip name' }).press('Enter');
  await expect(clipRows(page).first()).toHaveText(/^Clip: Lead take/);
  await expect.poll(async () => Object.values((await saved(page, id)).clips).find((c) => c.kind === 'audio')?.name).toBe('Lead take');
  const clip = Object.values((await saved(page, id)).clips).find((c) => c.kind === 'audio');
  expect(clip.gainDb).toBe(-6);
  expect(clip.fadeIn.length).toBe(Math.round(0.25 * (await saved(page, id)).audioRate));
  expect(clip.fadeOut.curve).toBe('equalPower');
  expect(clip.envelope).toEqual([{ frame: 0, gain: 1 }]);
});

test('deleting the last project that uses a source removes its stored record', async ({ page }) => {
  await createProject(page, 'Doomed');
  await importFixtures(page, [FIXTURES[0]]);
  await expect.poll(() => storedIds(page)).toHaveLength(1);
  await page.goto('/projects');
  await page.getByRole('button', { name: /^Delete Doomed/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Deleted Doomed' })).toHaveCount(1);
  await expect.poll(() => storedIds(page)).toEqual([]);
});

test('imported audio plays through the engine after the volume notice', async ({ page }) => {
  await createProject(page, 'Play');
  await importFixtures(page, [FIXTURES[0]]);
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  const play = page.getByRole('toolbar', { name: 'Transport' }).getByRole('button', { name: 'Play' });
  await play.click();
  await page.getByRole('alertdialog', { name: 'Volume notice' }).getByRole('button', { name: 'Continue' }).click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => globalThis.__wrackEngine.getMasterLevel().peakL), { timeout: 5000 }).toBeGreaterThan(0.001);
  expect(errors).toEqual([]);
});
