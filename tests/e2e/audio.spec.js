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

/** The instrument panel, the part these tests change; a whole-editor axe scan is slow in Firefox. */
const INSTRUMENT_PANEL = 'section[aria-labelledby="instrument-panel-heading"]';
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
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
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
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
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
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
  expect(results.violations).toEqual([]);
});

test('the Pluck panel shows damping, brightness and decay', async ({ page }) => {
  await openExample(page, 'Pluck melody');
  await page.getByRole('button', { name: 'Track 1: Pluck lead, Pluck synth' }).click();
  const panel = page.getByRole('region', { name: 'Pluck synth: Pluck lead' });
  await expect(panel.getByRole('slider', { name: 'Damping' })).toHaveAttribute('aria-valuetext', '50 %');
  await expect(panel.getByRole('slider', { name: 'Brightness' })).toHaveAttribute('aria-valuetext', '70 %');
  await expect(panel.getByRole('slider', { name: 'Decay (T60)' })).toHaveAttribute('aria-valuetext', '2.00 s');
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
  expect(results.violations).toEqual([]);
});

test('the Granular panel shows source, grain size, density and spray', async ({ page }) => {
  await openExample(page, 'Ambient');
  await page.getByRole('button', { name: 'Track 1: Texture, Granular synth' }).click();
  const panel = page.getByRole('region', { name: 'Granular synth: Texture' });
  await expect(panel.getByRole('group', { name: 'Source' }).getByRole('radio', { name: 'Saw' })).toBeChecked();
  await expect(panel.getByRole('slider', { name: 'Grain size' })).toHaveAttribute('aria-valuetext', '60 ms');
  await expect(panel.getByRole('slider', { name: 'Density' })).toHaveAttribute('aria-valuetext', '20.0 grains/s');
  await expect(panel.getByRole('slider', { name: 'Spray' })).toHaveAttribute('aria-valuetext', '20 %');
  const results = await new AxeBuilder({ page }).include(INSTRUMENT_PANEL).analyze();
  expect(results.violations).toEqual([]);
});

test('the drum machine panel: a voice selector with five voice controls and three kit controls', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Track 1: Drums, Drum machine' }).click();
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
  await expect(page.getByText('Saved on this device')).toBeVisible();
});

test('the Beat example plays with every instrument without engine errors', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  for (const title of ['Beat', 'Ambient']) {
    await openExample(page, title);
    await playButton(page).click();
    if (await notice(page).isVisible()) await notice(page).getByRole('button', { name: 'Continue' }).click();
    await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('position')).not.toHaveText('1.1.1', { timeout: 10_000 });
    await page.waitForTimeout(1500);
    await playButton(page).click();
  }
  expect(errors).toEqual([]);
});

async function startPlaying(page) {
  await playButton(page).click();
  if (await notice(page).isVisible()) await notice(page).getByRole('button', { name: 'Continue' }).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.getByText('Saved on this device')).toBeVisible();
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
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status').filter({ hasText: 'All sound stopped' })).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await masterPeakOver(page, 500)).toBeLessThan(1e-4);
});

test('Escape is Panic outside text fields, including on a focused button', async ({ page }) => {
  await openExample(page);
  await startPlaying(page);
  await page.getByRole('button', { name: 'Go to start' }).focus();
  await page.keyboard.press('Escape');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
  await startPlaying(page);
  await page.getByRole('textbox', { name: 'Tempo (BPM)' }).focus();
  await page.keyboard.press('Escape');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('Escape');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('computer keyboard notes pass through the volume notice and play the selected track', async ({ page }) => {
  await openExample(page, 'Pluck melody');
  await page.getByRole('button', { name: 'Track 2: Bass, Subtractive synth' }).click();
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
