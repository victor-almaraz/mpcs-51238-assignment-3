import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';
import { openTab, trackRow } from '../support/editor.js';

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
  await page.locator('input[type="file"][accept^="audio"]').first().setInputFiles(files);
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
  await page.locator('input[type="file"][accept^="audio"]').first().setInputFiles([
    { name: 'notes.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio at all') },
    FIXTURES[0],
  ]);
  await expect(results(page)).toContainText('Could not decode notes.wav. Supported formats: WAV, MP3, M4A/AAC, FLAC, OGG.');
  await expect(results(page)).toContainText('Added tone-a.wav.');
  await expect(clipRows(page)).toHaveCount(1);
});

test('keyboard only: split at the edit cursor, join, move, duplicate, delete and trim clips', async ({ page }) => {
  const id = await createProject(page, 'Edit');
  await importFixtures(page, [FIXTURES[0]]);
  const clip = clipRows(page).first();
  await clip.click();
  await expect(clip).toHaveAttribute('aria-selected', 'true');
  // The edit cursor moves by a beat; split two beats in.
  await page.keyboard.press('.');
  await page.keyboard.press('.');
  await expect(page.getByText('Edit cursor: bar 1 beat 3')).toBeVisible();
  await page.keyboard.press('Control+e');
  await expect(clipRows(page)).toHaveText([
    'Clip: tone-a, bar 1 to bar 1 beat 3, Saved on this device',
    'Clip: tone-a, bar 1 beat 3 to bar 2, Saved on this device',
  ]);
  await page.keyboard.press('Control+j');
  await expect(clipRows(page)).toHaveText(['Clip: tone-a, bar 1 to bar 2, Saved on this device']);
  await expect.poll(async () => Object.keys((await saved(page, id)).clips).length).toBe(1);

  await clipRows(page).first().focus();
  await page.keyboard.press('ArrowRight');
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
  await page.keyboard.press('Control+j');
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
  expect(clip.envelope).toEqual([expect.objectContaining({ frame: 0, gain: 1 })]);
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

/** Adds a sampler track and opens its panel. */
async function addSampler(page) {
  const tools = page.getByRole('toolbar', { name: 'Clip commands' });
  await tools.getByLabel('Instrument').selectOption('sampler');
  await tools.getByRole('button', { name: 'Add instrument track' }).click();
  // Adding a track selects it; its instrument panel is in the Devices tab.
  await expect(trackRow(page, 'Track 2: Track 2, Sampler')).toHaveAttribute('aria-selected', 'true');
  await openTab(page, 'Devices');
  return page.getByRole('region', { name: 'Sampler: Track 2' });
}

test('granular File source: choose File, load an audio file, and it saves with the project', async ({ page }) => {
  const id = await createProject(page, 'Grains');
  const tools = page.getByRole('toolbar', { name: 'Clip commands' });
  await tools.getByLabel('Instrument').selectOption('granular');
  await tools.getByRole('button', { name: 'Add instrument track' }).click();
  await expect(trackRow(page, 'Track 2: Track 2, Granular')).toHaveAttribute('aria-selected', 'true');
  await openTab(page, 'Devices');
  const panel = page.getByRole('region', { name: 'Granular synth: Track 2' });
  await expect(panel.getByRole('region', { name: 'File source' })).toHaveCount(0);
  await panel.getByRole('group', { name: 'Source' }).getByText('File').click();
  const file = panel.getByRole('region', { name: 'File source' });
  await expect(file).toContainText('No file. Load an audio file for the File source.');
  await panel.locator('input[type="file"]').setInputFiles([FIXTURES[0]]);
  await expect(file).toContainText('File: tone-a.wav, 2.00 s, Saved on this device');
  await expect.poll(async () => {
    const doc = await saved(page, id);
    const device = Object.values(doc?.devices ?? {}).find((d) => d.type === 'granular');
    return [device?.granular?.sourceName, Object.keys(doc?.sources ?? {}).length];
  }).toEqual(['tone-a.wav', 1]);
  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby="instrument-panel-heading"]').analyze();
  expect(axe.violations).toEqual([]);
  await file.getByRole('button', { name: 'Remove file' }).click();
  await expect(file).toContainText('No file.');
  await expect.poll(async () => Object.keys((await saved(page, id)).sources).length).toBe(0);
});

test('sampler: load a sample, then move markers by keyboard alone within their constraints', async ({ page }) => {
  const id = await createProject(page, 'Sampler');
  const panel = await addSampler(page);
  await expect(panel).toContainText('No sample. Load a sample file or choose a project source.');
  await panel.locator('input[type="file"]').setInputFiles([FIXTURES[0]]);
  await expect(panel).toContainText('Sample: tone-a.wav, 2.00 s, Saved on this device');
  await expect.poll(async () => (await saved(page, id)).audioRate).toBeGreaterThan(0);
  const rate = (await saved(page, id)).audioRate;

  const start = panel.getByRole('slider', { name: 'Start', exact: true });
  await start.focus();
  await page.keyboard.press('ArrowRight');
  await expect(start).toHaveAttribute('aria-valuetext', `0.001 seconds, frame ${Math.round(rate / 1000)}`);
  await page.keyboard.press('Shift+ArrowRight');
  await expect(start).toHaveAttribute('aria-valuetext', `0.001 seconds, frame ${Math.round(rate / 1000) + 1}`);
  await page.keyboard.press('PageUp');
  await expect(start).toHaveAttribute('aria-valuetext', new RegExp(`frame ${101 * Math.round(rate / 1000) + 1}$`));
  await page.keyboard.press('z');
  const snapped = Number((await start.getAttribute('aria-valuetext')).split('frame ')[1]);
  expect(Math.abs(snapped - (101 * Math.round(rate / 1000) + 1))).toBeLessThanOrEqual(2048);

  await panel.getByRole('group', { name: 'Loop mode' }).getByText('Forward').click();
  const loopStart = panel.getByRole('slider', { name: 'Loop start' });
  await expect(loopStart).toBeEnabled();
  await loopStart.focus();
  await page.keyboard.press('Home');
  await expect(loopStart).toHaveAttribute('aria-valuetext', new RegExp(`frame ${snapped + 1}$`));
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('status').filter({ hasText: 'Loop start cannot move past the marker before it' })).toHaveCount(1);
  await expect(loopStart).toHaveAttribute('aria-valuetext', new RegExp(`frame ${snapped + 1}$`));

  const root = panel.getByRole('spinbutton', { name: 'Root note' });
  await root.focus();
  await page.keyboard.press('ArrowUp');
  await expect(root).toHaveAttribute('aria-valuetext', 'C#4');
  await expect.poll(async () => Object.values((await saved(page, id)).devices).find((d) => d.type === 'sampler').params.rootNote).toBe(61);
});

test('sampler: a missing source shows "Audio not loaded" and importing the same file restores it', async ({ page }) => {
  const id = await createProject(page, 'Missing');
  await addSampler(page);
  await expect.poll(async () => Object.values((await saved(page, id)).devices).some((d) => d.type === 'sampler')).toBe(true);
  const doc = await saved(page, id);
  const device = Object.values(doc.devices).find((d) => d.type === 'sampler');
  const sha = await page.evaluate(async (bytes) => {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }, [...FIXTURES[0].buffer]);
  device.sampler = { sourceId: sha, sourceName: 'tone-a.wav' };
  doc.audioRate = 48000;
  doc.sources[sha] = { id: sha, name: 'tone-a.wav', path: `audio/${sha}.wav`, sampleRate: 48000, channels: 1, frames: 96000, format: 'audio/wav', sha256: sha };
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [`w-rack:v1:project:${id}`, JSON.stringify(doc)]);
  await page.reload();
  await expect(trackRow(page, 'Track 2: Track 2, Sampler')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Devices' })).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('region', { name: 'Sampler: Track 2' });
  await expect(panel).toContainText('Audio not loaded: tone-a.wav');
  await page.locator('input[type="file"][accept^="audio"]').first().setInputFiles([FIXTURES[0]]);
  await expect(panel).toContainText('Sample: tone-a.wav, 2.00 s, Saved on this device');
});

test('settings list stored audio with its projects; Clear all data removes everything', async ({ page }) => {
  await createProject(page, 'Kept');
  await importFixtures(page, [FIXTURES[0]]);
  await expect.poll(() => storedIds(page)).toHaveLength(1);
  await page.goto('/settings');
  const list = page.getByRole('list', { name: 'Stored audio files' });
  await expect(list).toContainText('tone-a.wav');
  await expect(list).toContainText('Used by Kept');
  await page.getByRole('button', { name: 'Clear all data' }).click();
  await page.getByRole('dialog', { name: 'Clear all data?' }).getByRole('button', { name: 'Clear all data' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('w-rack:')))).toEqual([]);
  expect(await storedIds(page)).toEqual([]);
});
