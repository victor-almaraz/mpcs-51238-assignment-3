import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function createProject(page, name = 'Effects') {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  return new URL(page.url()).pathname.split('/').pop();
}

const saved = (page, id) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);
const chain = (page, name) => page.getByRole('region', { name });
const chainTypes = async (page, id, which) => {
  const doc = await saved(page, id);
  const track = which === 'master' ? doc.tracks[doc.masterTrackId] : doc.tracks[doc.trackOrder[0]];
  const ids = which === 'master' ? track.deviceIds : track.deviceIds.slice(1);
  return ids.map((d) => [doc.devices[d].type, doc.devices[d].bypass]);
};

async function add(region, label) {
  await region.getByLabel('Effect', { exact: true }).selectOption({ label });
  await region.getByRole('button', { name: 'Add effect' }).click();
}

test('a track chain adds, edits, bypasses, reorders and removes effects with labelled controls', async ({ page }) => {
  const id = await createProject(page);
  const fx = chain(page, 'Effects: Track 1');
  await expect(fx).toContainText('No effects. The signal passes through unchanged.');
  await add(fx, 'Delay');
  await add(fx, 'Compressor');
  await expect(fx.getByRole('group', { name: 'Delay, 1 of 2' })).toBeVisible();
  await expect(fx.getByRole('group', { name: 'Compressor, 2 of 2' })).toBeVisible();
  await expect(fx.getByRole('slider', { name: 'Delay feedback' })).toHaveAttribute('aria-valuetext', '35 %');
  await expect(fx.getByLabel('Delay tempo sync')).toHaveValue('0');
  await fx.getByLabel('Delay tempo sync').selectOption({ label: '1/8 dotted' });
  const threshold = fx.getByRole('slider', { name: 'Compressor threshold' });
  await threshold.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(threshold).not.toHaveAttribute('aria-valuetext', '−18.0 dB');
  await fx.getByRole('button', { name: 'Bypass Delay' }).click();
  await expect(fx.getByRole('button', { name: 'Bypass Delay' })).toHaveAttribute('aria-pressed', 'true');
  await expect(fx.getByRole('group', { name: 'Delay, 1 of 2' })).toContainText('Bypassed');
  await expect.poll(() => chainTypes(page, id, 'track')).toEqual([['delay', true], ['compressor', false]]);
  await fx.getByRole('button', { name: 'Move Compressor left' }).click();
  await expect.poll(() => chainTypes(page, id, 'track')).toEqual([['compressor', false], ['delay', true]]);
  // Focus follows the moved device; at the first position its other move button takes it.
  await expect(fx.getByRole('button', { name: 'Move Compressor right' })).toBeFocused();
  await fx.getByRole('button', { name: 'Remove Delay' }).click();
  await expect.poll(() => chainTypes(page, id, 'track')).toEqual([['compressor', false]]);
  await expect(fx.getByRole('button', { name: 'Remove Compressor' })).toBeFocused();
  await add(fx, 'Delay');
  await add(fx, 'Delay');
  await expect(fx.getByRole('group', { name: 'Delay 2, 3 of 3' })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('section[aria-labelledby^="chain-"]').analyze();
  expect(axe.violations).toEqual([]);
});

test('the master chain holds effects; a project allows at most four reverbs', async ({ page }) => {
  const id = await createProject(page, 'Reverbs');
  const master = chain(page, 'Master effects');
  await add(master, 'EQ');
  await expect.poll(() => chainTypes(page, id, 'master')).toEqual([['eq3', false]]);
  const fx = chain(page, 'Effects: Track 1');
  for (let i = 0; i < 4; i++) await add(fx, 'Reverb');
  for (let i = 0; i < 4; i++) await add(fx, 'EQ');
  await expect(fx.getByRole('button', { name: 'Add effect' })).toBeDisabled();
  await expect(fx).toContainText('Chain full (8 of 8)');
  // Repeated types are numbered; numbers close up as devices go.
  for (let i = 0; i < 3; i++) await fx.getByRole('button', { name: 'Remove EQ 1', exact: true }).click();
  await fx.getByRole('button', { name: 'Remove EQ', exact: true }).click();
  await fx.getByLabel('Effect', { exact: true }).selectOption({ label: 'Reverb' });
  await expect(fx.getByRole('button', { name: 'Add effect' })).toBeDisabled();
  await expect(fx).toContainText('A project can have at most 4 reverbs.');
  await master.getByLabel('Effect', { exact: true }).selectOption({ label: 'Reverb' });
  await expect(master.getByRole('button', { name: 'Add effect' })).toBeDisabled();
});

test('an example with filter, reverb and delay plays through its chains after the volume notice', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Ambient' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ambient (copy)');
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
