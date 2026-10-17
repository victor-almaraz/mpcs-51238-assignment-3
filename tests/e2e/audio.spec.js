import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openTab, selectTrack } from '../support/editor.js';

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

/** The instrument panel, the part these tests change; a whole-editor axe scan is slow in Firefox. */
const INSTRUMENT_PANEL = 'section[aria-labelledby="instrument-panel-heading"]';
const transportBar = (page) => page.getByRole('toolbar', { name: 'Transport' });
/** The Play/Pause button, named for its action: "Play" while stopped or paused, "Pause" while playing. */
const playPause = (page) => transportBar(page).getByRole('button', { name: /^(Play|Pause)$/ });
const playButton = (page) => transportBar(page).getByRole('button', { name: 'Play', exact: true });
const pauseButton = (page) => transportBar(page).getByRole('button', { name: 'Pause', exact: true });
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
  await expect(playButton(page)).toBeVisible();
  await expect(playButton(page)).toHaveAccessibleDescription('Press Play to hear this example Shortcut: Space');
  await expect(page.getByText('Stopped')).toBeVisible();
  await expect(page.getByTestId('position')).toHaveText('1.1.1');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('Play opens the volume notice first; Cancel performs nothing', async ({ page }) => {
  await openExample(page);
  await playPause(page).click();
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
  await expect(playButton(page)).toBeVisible();
});

test('Escape cancels the volume notice', async ({ page }) => {
  await openExample(page);
  await playPause(page).click();
  await expect(notice(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notice(page)).toHaveCount(0);
  expect(await contexts(page)).toBe(0);
});

test('Continue starts audio and plays; Pause holds the position; the notice shows once per session', async ({ page }) => {
  await openExample(page);
  await playPause(page).click();
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(pauseButton(page)).toBeVisible();
  expect(await contexts(page)).toBe(1);
  await expect(page.getByText('Playing')).toBeVisible();
  await expect(page.getByTestId('position')).not.toHaveText('1.1.1', { timeout: 10_000 });
  await expect(page.getByText('Press Play to hear this example')).toHaveCount(0);

  await playPause(page).click();
  await expect(playButton(page)).toBeVisible();
  await expect(page.getByText('Paused')).toBeVisible();
  // The readout settles on the pause position within a frame or two.
  await page.waitForTimeout(100);
  const stoppedAt = await page.getByTestId('position').textContent();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('position')).toHaveText(stoppedAt);

  await playPause(page).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(pauseButton(page)).toBeVisible();
  expect(await contexts(page)).toBe(1);
});

test('Play, Pause, Stop: Pause holds and Play resumes; Stop returns to the play start, then to bar 1', async ({ page }) => {
  await openExample(page);
  const stopButton = transportBar(page).getByRole('button', { name: 'Stop', exact: true });
  const position = page.getByTestId('position');
  await expect(stopButton).toBeDisabled();
  // Start from bar 2: the edit cursor moves a bar with Shift+period on a track row.
  await page.getByRole('treegrid', { name: 'Tracks and clips' }).locator('[role="row"][aria-level="1"]').first().focus();
  await page.keyboard.press('Shift+Period');
  await expect(position).toHaveText('2.1.1');
  await expect(stopButton).toBeEnabled();

  await playPause(page).click();
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(pauseButton(page)).toBeVisible();
  await expect(position).not.toHaveText('2.1.1', { timeout: 10_000 });
  await pauseButton(page).click();
  await expect(page.getByText('Paused')).toBeVisible();
  await page.waitForTimeout(100);
  const pausedAt = await position.textContent();
  await page.waitForTimeout(400);
  await expect(position).toHaveText(pausedAt);

  // Play resumes from the paused position.
  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  // bar.beat.sixteenth in order (beats and sixteenths stay below 20).
  const order = (text) => text.split('.').map(Number).reduce((a, n) => a * 20 + n, 0);
  await expect.poll(async () => order(await position.textContent()), { timeout: 10_000 }).toBeGreaterThan(order(pausedAt));

  // Stop returns to where playback started; a second Stop goes to bar 1.
  await stopButton.click();
  await expect(playButton(page)).toBeVisible();
  await expect(page.getByText('Stopped')).toBeVisible();
  await expect(position).toHaveText('2.1.1');
  await stopButton.click();
  await expect(position).toHaveText('1.1.1');
  await expect(stopButton).toBeDisabled();
});

test('Space plays and pauses outside fields; Go to start returns to 1.1.1', async ({ page }) => {
  await openExample(page);
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press(' ');
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(pauseButton(page)).toBeVisible();
  await expect(page.getByTestId('position')).not.toHaveText('1.1.1', { timeout: 10_000 });
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press(' ');
  await expect(playButton(page)).toBeVisible();

  await page.getByRole('textbox', { name: 'Tempo (BPM)' }).focus();
  await page.keyboard.press(' ');
  await expect(playButton(page)).toBeVisible();

  await page.getByRole('button', { name: 'Go to start' }).click();
  await expect(page.getByTestId('position')).toHaveText('1.1.1');
});

test('"Don\'t show this again" stores the dismissal; later visits skip the notice', async ({ page }) => {
  await openExample(page);
  await playPause(page).click();
  await notice(page).getByRole('checkbox', { name: "Don't show this again on this device" }).check();
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(pauseButton(page)).toBeVisible();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('w-rack:v1:settings')));
  expect(settings.volumeNoticeDismissed).toBe(true);

  await openExample(page, 'Ambient');
  expect(await contexts(page)).toBe(0);
  await playPause(page).click();
  await expect(pauseButton(page)).toBeVisible();
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
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
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
  await selectTrack(page, 'Track 2: Bass, Subtractive synth');
  await openTab(page, 'Devices');
  const panel = page.getByRole('region', { name: 'Subtractive synth: Bass' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('group', { name: 'Waveform' }).getByRole('radio', { name: 'Saw' })).toBeChecked();
  const cutoff = panel.getByRole('slider', { name: 'Cutoff' });
  await expect(cutoff).toHaveAttribute('aria-valuetext', '2.0 kHz');
  await expect(panel.getByRole('slider', { name: 'Attack' })).toHaveAttribute('aria-valuetext', '10 ms');
  await expect(panel.getByRole('slider', { name: 'Resonance' })).toHaveAttribute('aria-valuetext', '1.0 dB');
  await expect(panel.getByRole('slider', { name: 'Filter env' })).toHaveAttribute('aria-valuetext', '0.0 oct');
  await expect(panel.getByRole('slider', { name: 'Decay', exact: true })).toHaveAttribute('aria-valuetext', '300 ms');
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
  expect(results.violations).toEqual([]);

  await cutoff.focus();
  await page.keyboard.press('PageUp');
  await expect(cutoff).not.toHaveAttribute('aria-valuetext', '2.0 kHz');
  await panel.getByRole('group', { name: 'Waveform' }).getByText('Square').click();
  await expect(panel.getByRole('radio', { name: 'Square' })).toBeChecked();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
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
  await playPause(page).click();
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(pauseButton(page)).toBeVisible();
  await expect(page.getByTestId('position')).not.toHaveText('1.1.1', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await playPause(page).click();
  expect(errors).toEqual([]);
});

test('the FM panel shows ratio, fine, index, index decay, ADSR and tuning with units', async ({ page }) => {
  await openExample(page);
  await selectTrack(page, 'Track 3: Lead stab, FM synth');
  await openTab(page, 'Devices');
  const panel = page.getByRole('region', { name: 'FM synth: Lead stab' });
  await expect(panel.getByRole('slider', { name: 'Ratio' })).toHaveAttribute('aria-valuetext', '2.0×');
  await expect(panel.getByRole('slider', { name: 'Index', exact: true })).toHaveAttribute('aria-valuetext', '3');
  await expect(panel.getByRole('slider', { name: 'Index decay' })).toHaveAttribute('aria-valuetext', '500 ms');
  await expect(panel.getByRole('slider', { name: 'Fine' })).toHaveAttribute('aria-valuetext', '0.00');
  await expect(panel.getByRole('slider', { name: 'Sustain' })).toHaveAttribute('aria-valuetext', '100 %');
  const tuning = panel.getByRole('group', { name: 'Tuning' });
  await expect(tuning.getByRole('slider', { name: 'Octave' })).toHaveAttribute('aria-valuetext', '0 oct');
  await expect(tuning.getByRole('slider', { name: 'Cents' })).toHaveAttribute('aria-valuetext', '0 cents');
  const ratio = panel.getByRole('slider', { name: 'Ratio' });
  await ratio.focus();
  await page.keyboard.press('ArrowRight');
  await expect(ratio).toHaveAttribute('aria-valuetext', '2.5×');
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
  expect(results.violations).toEqual([]);
});

test('the Additive panel groups eight harmonic sliders and shows the envelope and vibrato', async ({ page }) => {
  await openExample(page, 'Ambient');
  await selectTrack(page, 'Track 2: Pad, Additive synth');
  await openTab(page, 'Devices');
  const panel = page.getByRole('region', { name: 'Additive synth: Pad' });
  const harmonics = panel.getByRole('group', { name: 'Harmonics' });
  await expect(harmonics.getByRole('slider')).toHaveCount(8);
  await expect(harmonics.getByRole('slider', { name: 'Harmonic 1' })).toHaveAttribute('aria-valuetext', '100 %');
  await expect(harmonics.getByRole('slider', { name: 'Harmonic 2' })).toHaveAttribute('aria-valuetext', '50 %');
  await expect(panel.getByRole('slider', { name: 'Release' })).toHaveAttribute('aria-valuetext', '500 ms');
  await expect(panel.getByRole('slider', { name: 'Decay', exact: true })).toHaveAttribute('aria-valuetext', '500 ms');
  await expect(panel.getByRole('slider', { name: 'Vibrato rate' })).toHaveAttribute('aria-valuetext', '5 Hz');
  const vibrato = panel.getByRole('slider', { name: 'Vibrato', exact: true });
  await expect(vibrato).toHaveAttribute('aria-valuetext', '0 cents');
  await vibrato.focus();
  await page.keyboard.press('ArrowRight');
  await expect(vibrato).toHaveAttribute('aria-valuetext', '1 cents');
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
  expect(results.violations).toEqual([]);
});

test('the Pluck panel shows damping, brightness, pick position, decay and release', async ({ page }) => {
  await openExample(page, 'Pluck melody');
  await selectTrack(page, 'Track 1: Pluck lead, Pluck synth');
  await openTab(page, 'Devices');
  const panel = page.getByRole('region', { name: 'Pluck synth: Pluck lead' });
  await expect(panel.getByRole('slider', { name: 'Damping' })).toHaveAttribute('aria-valuetext', '50 %');
  await expect(panel.getByRole('slider', { name: 'Brightness' })).toHaveAttribute('aria-valuetext', '70 %');
  await expect(panel.getByRole('slider', { name: 'Decay (T60)' })).toHaveAttribute('aria-valuetext', '2.00 s');
  await expect(panel.getByRole('slider', { name: 'Pick position' })).toHaveAttribute('aria-valuetext', '0 %');
  await expect(panel.getByRole('slider', { name: 'Release' })).toHaveAttribute('aria-valuetext', '100 ms');
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
  expect(results.violations).toEqual([]);
});

test('the Granular panel shows source, position, grain size, density, spray, pitch spread and envelope', async ({ page }) => {
  await openExample(page, 'Ambient');
  await selectTrack(page, 'Track 1: Texture, Granular synth');
  await openTab(page, 'Devices');
  const panel = page.getByRole('region', { name: 'Granular synth: Texture' });
  await expect(panel.getByRole('group', { name: 'Source' }).getByRole('radio', { name: 'Saw' })).toBeChecked();
  await expect(panel.getByRole('slider', { name: 'Grain size' })).toHaveAttribute('aria-valuetext', '60 ms');
  await expect(panel.getByRole('slider', { name: 'Density' })).toHaveAttribute('aria-valuetext', '20.0 grains/s');
  await expect(panel.getByRole('slider', { name: 'Spray' })).toHaveAttribute('aria-valuetext', '20 %');
  await expect(panel.getByRole('group', { name: 'Source' }).getByRole('radio')).toHaveCount(4);
  await expect(panel.getByRole('slider', { name: 'Position' })).toHaveAttribute('aria-valuetext', '50 %');
  await expect(panel.getByRole('slider', { name: 'Pitch spread' })).toHaveAttribute('aria-valuetext', '0 cents');
  await expect(panel.getByRole('slider', { name: 'Attack' })).toHaveAttribute('aria-valuetext', '50 ms');
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
  expect(results.violations).toEqual([]);
});

test('the drum machine panel: a voice selector with five voice controls and three kit controls', async ({ page }) => {
  await openExample(page);
  await selectTrack(page, 'Track 1: Drums, Drum machine');
  await openTab(page, 'Devices');
  const panel = page.getByRole('region', { name: 'Drum machine: Drums' });
  const voice = panel.getByRole('combobox', { name: 'Voice' });
  await expect(voice).toHaveValue('kick');
  await expect(voice.locator('option')).toHaveCount(14);
  const kick = panel.getByRole('group', { name: 'Kick' });
  await expect(kick.getByRole('slider')).toHaveCount(5);
  await expect(kick.getByRole('slider', { name: 'Level', exact: true })).toHaveAttribute('aria-valuetext', '0.0 dB');
  await expect(kick.getByRole('slider', { name: 'Tune' })).toHaveAttribute('aria-valuetext', '0.0 st');
  await expect(kick.getByRole('slider', { name: 'Decay' })).toHaveAttribute('aria-valuetext', '1.0×');
  await expect(kick.getByRole('slider', { name: 'Click level' })).toHaveAttribute('aria-valuetext', '50 %');
  await expect(kick.getByRole('slider', { name: 'Pan' })).toHaveAttribute('aria-valuetext', 'C');
  const kit = panel.getByRole('group', { name: 'Kit' });
  await expect(kit.getByRole('slider', { name: 'Kit level', exact: true })).toHaveAttribute('aria-valuetext', '0.0 dB');
  await expect(kit.getByRole('slider', { name: 'Velocity sensitivity' })).toHaveAttribute('aria-valuetext', '100 %');
  await expect(kit.getByRole('group', { name: 'Choke' }).getByRole('radio', { name: 'On' })).toBeChecked();
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
  expect(results.violations).toEqual([]);

  await voice.selectOption('closedHat');
  const hat = panel.getByRole('group', { name: 'Closed hat' });
  await expect(hat.getByRole('slider', { name: 'Highpass' })).toBeVisible();
  const pan = hat.getByRole('slider', { name: 'Pan' });
  await pan.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft');
  await expect(pan).toHaveAttribute('aria-valuetext', 'L20');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
});

test('the Beat example plays with every instrument without engine errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  for (const title of ['Beat', 'Ambient']) {
    await openExample(page, title);
    await playPause(page).click();
    if (await notice(page).isVisible()) await notice(page).getByRole('button', { name: 'Continue' }).click();
    await expect(pauseButton(page)).toBeVisible();
    await expect(page.getByTestId('position')).not.toHaveText('1.1.1', { timeout: 10_000 });
    await page.waitForTimeout(1500);
    await playPause(page).click();
  }
  expect(errors).toEqual([]);
});

async function startPlaying(page) {
  await playPause(page).click();
  if (await notice(page).isVisible()) await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(pauseButton(page)).toBeVisible();
}

/** Largest post-limiter master peak seen over `ms` milliseconds. */
async function masterPeakOver(page, ms) {
  return page.evaluate(async (duration) => {
    const engine = window.__wrackEngine;
    let most = 0;
    const until = performance.now() + duration;
    while (performance.now() < until) {
      const level = engine.getMasterLevel();
      most = Math.max(most, level.peakL, level.peakR);
      await new Promise((r) => setTimeout(r, 20));
    }
    return most;
  }, ms);
}

test('the mixer: named strips with volume, pan, mute and solo, and a master strip', async ({ page }) => {
  await openExample(page);
  await openTab(page, 'Mixer');
  const mixer = page.getByRole('region', { name: 'Mixer' });
  await expect(mixer.getByRole('slider', { name: 'Drums volume' })).toHaveAttribute('aria-valuetext', '0.0 dB');
  await expect(mixer.getByRole('slider', { name: 'Bass pan' })).toHaveAttribute('aria-valuetext', 'Centre');
  await expect(mixer.getByRole('button', { name: 'Mute Bass' })).toHaveAttribute('aria-pressed', 'false');
  await expect(mixer.getByRole('button', { name: 'Solo Lead stab' })).toHaveAttribute('aria-pressed', 'false');
  await expect(mixer.getByRole('slider', { name: 'Master volume' })).toHaveAttribute('aria-valuetext', '−12.0 dB');
  await expect(mixer.getByRole('slider', { name: 'Master pan' })).toHaveAttribute('aria-valuetext', 'Centre');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await mixer.getByRole('button', { name: 'Mute Bass' }).click();
  await expect(mixer.getByRole('button', { name: 'Mute Bass' })).toHaveAttribute('aria-pressed', 'true');
  const pan = mixer.getByRole('slider', { name: 'Bass pan' });
  await pan.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft');
  await expect(pan).toHaveAttribute('aria-valuetext', 'Left 20');
  await page.keyboard.press('Delete');
  await expect(pan).toHaveAttribute('aria-valuetext', 'Centre');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').pop();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);
  expect(Object.values(saved.tracks).find((t) => t.name === 'Bass').mute).toBe(true);

  const master = mixer.getByRole('slider', { name: 'Master volume' });
  await master.focus();
  await page.keyboard.press('PageDown');
  await expect(master).toHaveAttribute('aria-valuetext', '−18.0 dB');
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('w-rack:v1:settings')));
  expect(settings.masterVolumeDb).toBe(-18);
});

for (const title of ['Beat', 'Ambient', 'Pluck melody']) {
  test(`the ${title} example plays audibly through the safety stage`, async ({ page }) => {
    await openExample(page, title);
    await startPlaying(page);
    const most = await masterPeakOver(page, 2500);
    expect(most).toBeGreaterThan(0.005);
    expect(most).toBeLessThanOrEqual(0.8913);
  });
}

test('Panic stops playback and all sound, and is announced', async ({ page }) => {
  await openExample(page);
  await startPlaying(page);
  expect(await masterPeakOver(page, 1500)).toBeGreaterThan(0.005);
  await page.getByRole('button', { name: 'Panic' }).click();
  await expect(playButton(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'All sound stopped' })).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await masterPeakOver(page, 500)).toBeLessThan(1e-4);
});

test('Escape is Panic outside text fields, including on a focused button', async ({ page }) => {
  await openExample(page);
  await startPlaying(page);
  await page.getByRole('button', { name: 'Go to start' }).focus();
  await page.keyboard.press('Escape');
  await expect(playButton(page)).toBeVisible();
  await startPlaying(page);
  await page.getByRole('textbox', { name: 'Tempo (BPM)' }).focus();
  await page.keyboard.press('Escape');
  await expect(pauseButton(page)).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('Escape');
  await expect(playButton(page)).toBeVisible();
});

test('computer keyboard notes pass through the volume notice and play the selected track', async ({ page }) => {
  await openExample(page, 'Pluck melody');
  await selectTrack(page, 'Track 2: Bass, Subtractive synth');
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.down('KeyA');
  await expect(notice(page)).toBeVisible();
  await page.keyboard.up('KeyA');
  await notice(page).getByRole('button', { name: 'Continue' }).click();
  // The key was released during the notice, so its note never starts.
  expect(await masterPeakOver(page, 600)).toBeLessThan(1e-3);
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.down('KeyA');
  const held = await masterPeakOver(page, 600);
  await page.keyboard.up('KeyA');
  expect(held).toBeGreaterThan(0.005);
  await page.waitForTimeout(800);
  expect(await masterPeakOver(page, 300)).toBeLessThan(1e-3);
});

test('Z and X change the keyboard octave and save it; typing in a field plays nothing', async ({ page }) => {
  await openExample(page);
  await expect(page.getByText('Keyboard octave: C4')).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('KeyX');
  await expect(page.getByText('Keyboard octave: C5')).toBeVisible();
  await page.keyboard.press('KeyZ');
  await page.keyboard.press('KeyZ');
  await expect(page.getByText('Keyboard octave: C3')).toBeVisible();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('w-rack:v1:settings')));
  expect(settings.keyboardOctave).toBe(3);
  await page.getByRole('textbox', { name: 'Tempo (BPM)' }).focus();
  await page.keyboard.press('KeyA');
  await expect(notice(page)).toHaveCount(0);
  await page.keyboard.press('Backspace');
  await page.getByRole('button', { name: 'Play with keyboard' }).click();
  await expect(page.getByRole('button', { name: 'Play with keyboard' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('KeyA');
  await expect(notice(page)).toHaveCount(0);
});

test('Web MIDI states the browser\'s support before and after Connect MIDI device', async ({ page, context, browserName }) => {
  await openExample(page);
  const region = page.getByRole('region', { name: 'Live input' });
  if (browserName === 'webkit') {
    await expect(region.getByText('Web MIDI is not supported in this browser.')).toBeVisible();
    await region.getByRole('button', { name: 'Connect MIDI device' }).click();
    await expect(region.getByRole('status').filter({ hasText: 'Web MIDI is not supported in this browser.' })).toBeVisible();
  } else if (browserName === 'firefox') {
    // Requesting access starts Firefox's add-on install prompt, which headless runs cannot answer.
    await expect(region.getByText('Firefox asks to install a site permission add-on. Connect the MIDI device before starting Firefox.')).toBeVisible();
  } else {
    await context.grantPermissions(['midi']);
    await region.getByRole('button', { name: 'Connect MIDI device' }).click();
    // Headless Chromium refuses Web MIDI even with the permission granted; each outcome has a status.
    await expect(region.getByRole('status').filter({ hasText: /No MIDI devices found|MIDI input:|MIDI access was not allowed/ })).toBeVisible();
  }
});

test('a track changes instrument in place; clips and effects stay, and Undo restores it', async ({ page }) => {
  await openExample(page);
  await selectTrack(page, 'Track 2: Bass, Subtractive synth');
  await openTab(page, 'Devices');
  const panel = page.getByRole('region', { name: 'Subtractive synth: Bass' });
  const id = new URL(page.url()).pathname.split('/').pop();
  const bassOf = async () => {
    const doc = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `w-rack:v1:project:${id}`);
    const track = Object.values(doc?.tracks ?? {}).find((t) => t.name === 'Bass');
    return track && { type: doc.devices[track.deviceIds[0]].type, effects: track.deviceIds.length - 1, clips: track.clipIds.length };
  };
  await panel.getByLabel('Instrument', { exact: true }).selectOption({ label: 'FM synth' });
  const fm = page.getByRole('region', { name: 'FM synth: Bass' });
  await expect(fm).toBeVisible();
  await expect(fm.getByRole('slider', { name: 'Ratio' })).toHaveAttribute('aria-valuetext', '2.0×');
  await expect(page.getByRole('status').filter({ hasText: 'Bass is now an FM synth' })).toHaveCount(1);
  await expect(page.getByRole('treegrid', { name: 'Tracks and clips' }).getByRole('row', { name: /^Track 2: Bass, FM synth/ })).toBeVisible();
  await expect.poll(async () => (await bassOf())?.type).toBe('fm');
  const swapped = await bassOf();
  expect(swapped.clips).toBeGreaterThan(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('region', { name: 'Subtractive synth: Bass' })).toBeVisible();
  await expect.poll(async () => (await bassOf()).type).toBe('subtractive');
  expect((await bassOf()).clips).toBe(swapped.clips);
});
