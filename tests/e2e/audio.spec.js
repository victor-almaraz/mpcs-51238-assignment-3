import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Counts AudioContext constructions in window.__audioContexts. */
async function spyOnAudioContext(page) {
  await page.addInitScript(() => {
    window.__audioContexts = 0;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        window.__audioContexts++;
      }
    };
  });
}

const contexts = (page) => page.evaluate(() => window.__audioContexts);

async function openExample(page, title = 'Beat') {
  await page.goto('/');
  await page.getByRole('button', { name: `Open ${title}` }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${title} (copy)`);
}

const playButton = (page) => page.getByRole('toolbar', { name: 'Transport' }).getByRole('button', { name: 'Play' });
const notice = (page) => page.getByRole('alertdialog', { name: 'Volume notice' });

test.beforeEach(async ({ page }) => {
  await spyOnAudioContext(page);
});

test('pages load silently: no AudioContext before a sound-producing action', async ({ page }) => {
  for (const path of ['/', '/new', '/projects', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await contexts(page), path).toBe(0);
  }
  await openExample(page);
  expect(await contexts(page)).toBe(0);
});

test('an example opens stopped with Play highlighted and the hint linked to it', async ({ page }) => {
  await openExample(page);
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(playButton(page)).toHaveAccessibleDescription('Press Play to hear this example');
  await expect(page.getByText('Stopped')).toBeVisible();
  await expect(page.getByTestId('position')).toHaveText('1.1.1');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('Play opens the volume notice first; Cancel performs nothing', async ({ page }) => {
  await openExample(page);
  await playButton(page).click();
  const dialog = notice(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Turn your device volume down. W-Rack is about to play sound.');
  await expect(dialog.getByRole('checkbox', { name: "Don't show this again on this device" })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Continue' })).toBeFocused();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  expect(await contexts(page)).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await contexts(page)).toBe(0);
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('Escape cancels the volume notice', async ({ page }) => {
  await openExample(page);
  await playButton(page).click();
  await expect(notice(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notice(page)).toHaveCount(0);
  expect(await contexts(page)).toBe(0);
});

test('Continue starts audio and plays; Stop holds the position; the notice shows once per session', async ({ page }) => {
  await openExample(page);
  await playButton(page).click();
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await contexts(page)).toBe(1);
  await expect(page.getByText('Playing')).toBeVisible();
  await expect(page.getByTestId('position')).not.toHaveText('1.1.1', { timeout: 10_000 });
  await expect(page.getByText('Press Play to hear this example')).toHaveCount(0);

  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
  const stoppedAt = await page.getByTestId('position').textContent();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('position')).toHaveText(stoppedAt);

  await playButton(page).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await contexts(page)).toBe(1);
});

test('Space plays and stops outside fields; Go to start returns to 1.1.1', async ({ page }) => {
  await openExample(page);
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press(' ');
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('position')).not.toHaveText('1.1.1', { timeout: 10_000 });
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press(' ');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('textbox', { name: 'Tempo (BPM)' }).focus();
  await page.keyboard.press(' ');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Go to start' }).click();
  await expect(page.getByTestId('position')).toHaveText('1.1.1');
});

test('"Don\'t show this again" stores the dismissal; later visits skip the notice', async ({ page }) => {
  await openExample(page);
  await playButton(page).click();
  await notice(page).getByRole('checkbox', { name: "Don't show this again on this device" }).check();
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('w-rack:v1:settings')));
  expect(settings.volumeNoticeDismissed).toBe(true);

  await openExample(page, 'Ambient');
  expect(await contexts(page)).toBe(0);
  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(notice(page)).toHaveCount(0);
  expect(await contexts(page)).toBe(1);
});

test('the metronome choice is saved in settings', async ({ page }) => {
  await openExample(page);
  const metronome = page.getByRole('button', { name: 'Metronome' });
  await expect(metronome).toHaveAttribute('aria-pressed', 'false');
  await metronome.click();
  await expect(metronome).toHaveAttribute('aria-pressed', 'true');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('w-rack:v1:settings')));
  expect(settings.metronome).toBe(true);
  expect(await contexts(page)).toBe(0, 'toggling the metronome makes no sound');
});

test('a tempo edit is the first edit: the example copy saves as a project', async ({ page }) => {
  await openExample(page);
  const id = new URL(page.url()).pathname.split('/').pop();
  await expect(page.getByText('Copy of example — saved on first edit')).toBeVisible();
  const tempo = page.getByRole('textbox', { name: 'Tempo (BPM)' });
  await tempo.fill('90');
  await tempo.press('Enter');
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await expect(page.getByText('90 BPM · 4/4')).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);
  expect(saved.name).toBe('Beat (copy)');
  expect(saved.tempo[0].bpm).toBe(90);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Recent' })).toContainText('Beat (copy)');
});

test('an invalid tempo shows the form error and changes nothing', async ({ page }) => {
  await openExample(page);
  const tempo = page.getByRole('textbox', { name: 'Tempo (BPM)' });
  await tempo.fill('500');
  await tempo.press('Enter');
  await expect(page.getByText('Enter a tempo between 40 and 240.')).toBeVisible();
  await expect(tempo).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('100 BPM · 4/4')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes(':project:')))).toEqual([]);
});

test('the Subtractive panel shows labelled controls with units, and an edit saves', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Track 2: Bass, Subtractive synth' }).click();
  const panel = page.getByRole('region', { name: 'Subtractive synth: Bass' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('group', { name: 'Waveform' }).getByRole('radio', { name: 'Saw' })).toBeChecked();
  const cutoff = panel.getByRole('slider', { name: 'Cutoff' });
  await expect(cutoff).toHaveAttribute('aria-valuetext', '2.0 kHz');
  await expect(panel.getByRole('slider', { name: 'Attack' })).toHaveAttribute('aria-valuetext', '10 ms');
  await expect(panel.getByRole('slider', { name: 'Resonance' })).toHaveAttribute('aria-valuetext', '1.0 dB');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await cutoff.focus();
  await page.keyboard.press('PageUp');
  await expect(cutoff).not.toHaveAttribute('aria-valuetext', '2.0 kHz');
  await panel.getByRole('group', { name: 'Waveform' }).getByText('Square').click();
  await expect(panel.getByRole('radio', { name: 'Square' })).toBeChecked();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);
  const bass = Object.values(saved.devices).find((d) => d.type === 'subtractive');
  expect(bass.params.waveform).toBe(1);
  expect(bass.params.cutoff).toBeGreaterThan(2000);
});

test('playing an example with Subtractive tracks runs without engine errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await openExample(page, 'Pluck melody');
  await playButton(page).click();
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('position')).not.toHaveText('1.1.1', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await playButton(page).click();
  expect(errors).toEqual([]);
});

test('the FM panel shows ratio, index and index decay with units', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Track 3: Lead stab, FM synth' }).click();
  const panel = page.getByRole('region', { name: 'FM synth: Lead stab' });
  await expect(panel.getByRole('slider', { name: 'Ratio' })).toHaveAttribute('aria-valuetext', '2.0×');
  await expect(panel.getByRole('slider', { name: 'Index', exact: true })).toHaveAttribute('aria-valuetext', '3');
  await expect(panel.getByRole('slider', { name: 'Index decay' })).toHaveAttribute('aria-valuetext', '500 ms');
  const ratio = panel.getByRole('slider', { name: 'Ratio' });
  await ratio.focus();
  await page.keyboard.press('ArrowRight');
  await expect(ratio).toHaveAttribute('aria-valuetext', '2.5×');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('the Additive panel groups eight harmonic sliders with percent values', async ({ page }) => {
  await openExample(page, 'Ambient');
  await page.getByRole('button', { name: 'Track 2: Pad, Additive synth' }).click();
  const panel = page.getByRole('region', { name: 'Additive synth: Pad' });
  const harmonics = panel.getByRole('group', { name: 'Harmonics' });
  await expect(harmonics.getByRole('slider')).toHaveCount(8);
  await expect(harmonics.getByRole('slider', { name: 'Harmonic 1' })).toHaveAttribute('aria-valuetext', '100 %');
  await expect(harmonics.getByRole('slider', { name: 'Harmonic 2' })).toHaveAttribute('aria-valuetext', '50 %');
  await expect(panel.getByRole('slider', { name: 'Release' })).toHaveAttribute('aria-valuetext', '500 ms');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
