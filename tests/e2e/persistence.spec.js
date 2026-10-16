import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const STORAGE_FULL = "This device's browser storage is full. Save a .wrack file, then delete unused projects.";

/** Creates a project through the form and returns its ID. */
async function createProject(page, name) {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return new URL(page.url()).pathname.split('/').pop();
}

const read = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const write = (page, key, value) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value]);

const trackToggle = (page) => page.getByRole('button', { name: 'Track 1: Track 1, Subtractive synth' });

test('working state is restored after a reload and through Continue; the transport stays stopped', async ({ page }) => {
  const id = await createProject(page, 'Return song');
  const projectBefore = await read(page, `w-rack:v1:project:${id}`);

  await trackToggle(page).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByText('Zoom 400%')).toBeVisible();
  await expect.poll(() => read(page, `w-rack:v1:view:${id}`)).toContain('"zoom":4');
  expect(await read(page, `w-rack:v1:project:${id}`)).toBe(projectBefore);

  await page.reload();
  await expect(page.getByText('Zoom 400%')).toBeVisible();
  await expect(trackToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Stopped')).toBeVisible();

  await page.goto('/');
  await page.getByRole('region', { name: 'Recent' }).getByRole('link', { name: /^Continue Return song/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Return song');
  await expect(page.getByText('Zoom 400%')).toBeVisible();
  await expect(trackToggle(page)).toHaveAttribute('aria-pressed', 'true');
});

test('pending working state is written when the page is hidden', async ({ page }) => {
  const id = await createProject(page, 'Hide song');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  expect(await read(page, `w-rack:v1:view:${id}`)).toContain('"zoom":2');
});

test('playhead, loop and open panel are restored from stored working state', async ({ page }) => {
  const id = await createProject(page, 'Seeded');
  const view = { playhead: 2 * 3840 + 960, loop: { start: 0, end: 7680 }, loopEnabled: true, zoom: 0.5, openPanel: 'pianoroll' };
  await write(page, `w-rack:v1:view:${id}`, JSON.stringify(view));
  await page.reload();
  await expect(page.getByText('Playhead: bar 3, beat 2')).toBeVisible();
  await expect(page.getByText('Loop on: bar 1 to bar 3')).toBeVisible();
  await expect(page.getByText('Zoom 50%')).toBeVisible();
  await expect(page.getByText('Open panel: Piano roll')).toBeVisible();
  await expect(page.getByText('Stopped')).toBeVisible();
});

test('corrupted project JSON shows the guarded message', async ({ page }) => {
  const id = await createProject(page, 'Broken');
  await write(page, `w-rack:v1:project:${id}`, '{"schemaVersion": 1, "id":');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A saved project could not be read.');
  await expect(page.getByRole('main').getByRole('link', { name: 'Projects' })).toBeVisible();
});

test('corrupted working state opens the default view', async ({ page }) => {
  const id = await createProject(page, 'Odd view');
  await write(page, `w-rack:v1:view:${id}`, '[[[');
  await page.reload();
  await expect(page.getByText('Zoom 100%')).toBeVisible();
  await expect(trackToggle(page)).toHaveAttribute('aria-pressed', 'false');
});

test('audio clips without loaded audio show "Audio not loaded" and the restore action', async ({ page }) => {
  const id = await createProject(page, 'With audio');
  const doc = JSON.parse(await read(page, `w-rack:v1:project:${id}`));
  doc.trackOrder.push('trk_audio');
  doc.tracks.trk_audio = { ...doc.tracks[doc.trackOrder[0]], id: 'trk_audio', kind: 'audio', name: 'Vocals', deviceIds: [], clipIds: ['clp_voice'] };
  doc.clips.clp_voice = {
    id: 'clp_voice', trackId: 'trk_audio', kind: 'audio', start: 0, name: 'Verse take', muted: false,
    sourceId: 'src_x', sourceOffset: 0, sourceLength: 48000, gainDb: 0,
    fadeIn: { length: 0, curve: 'linear' }, fadeOut: { length: 0, curve: 'linear' },
  };
  await write(page, `w-rack:v1:project:${id}`, JSON.stringify(doc));
  await page.reload();
  await expect(page.getByRole('treegrid', { name: 'Tracks and clips' }).getByRole('row', { name: /^Clip: Verse take/ })).toHaveText(
    'Clip: Verse take, bar 1 to bar 1 beat 3, Audio not loaded',
  );
  await expect(page.getByRole('toolbar').getByRole('button', { name: 'Open .wrack file to restore audio' })).toBeVisible();
});

test('a quota error while saving working state shows the storage message', async ({ page }) => {
  await createProject(page, 'Full');
  await page.evaluate(() => {
    Storage.prototype.setItem = function setItem() {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(STORAGE_FULL);
});

test('turning off "Remember settings on this device" removes the settings key', async ({ page }) => {
  await page.goto('/settings');
  await write(page, 'w-rack:v1:settings', JSON.stringify({ volumeNoticeDismissed: true, metronome: true }));
  await page.reload();
  const toggle = page.getByRole('button', { name: 'Remember settings on this device' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await read(page, 'w-rack:v1:settings')).toBeNull();
  await expect(page.getByRole('button', { name: 'Show the volume notice again' })).toBeDisabled();
});

test('"Show the volume notice again" clears the stored dismissal', async ({ page }) => {
  await page.goto('/settings');
  await write(page, 'w-rack:v1:settings', JSON.stringify({ volumeNoticeDismissed: true }));
  await page.reload();
  const button = page.getByRole('button', { name: 'Show the volume notice again' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeDisabled();
  expect(JSON.parse(await read(page, 'w-rack:v1:settings')).volumeNoticeDismissed).toBe(false);
  await expect(page.getByText(/use about \d+\.\d KB of 5 MB browser storage/)).toBeVisible();
});

test('Projects lists saved projects and deletes one after confirmation', async ({ page }) => {
  const keepId = await createProject(page, 'Keep me');
  const dropId = await createProject(page, 'Drop me');
  await page.goto('/projects');
  const list = page.getByRole('list', { name: 'Saved projects' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').first()).toContainText('Drop me');

  await list.getByRole('button', { name: /^Delete Drop me/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Drop me?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Delete project' }).click();

  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Keep me');
  expect(await read(page, `w-rack:v1:project:${dropId}`)).toBeNull();
  expect(await read(page, `w-rack:v1:project:${keepId}`)).not.toBeNull();
});

test('Escape closes the delete dialog and keeps the project', async ({ page }) => {
  await createProject(page, 'Stay');
  await page.goto('/projects');
  const deleteButton = page.getByRole('button', { name: /^Delete Stay/ });
  await deleteButton.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(deleteButton).toBeFocused();
  await expect(page.getByRole('list', { name: 'Saved projects' }).getByRole('listitem')).toHaveCount(1);
});

test('Projects shows an empty state without saved projects', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByText('No saved projects on this device.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Create a project' })).toHaveAttribute('href', '/new');
});
