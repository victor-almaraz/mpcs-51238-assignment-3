import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/*
 * Accessibility pass (assignment-3-scope.md, Labeling and Accessibility):
 * axe on every route and dialog state, and every interactive element's role
 * and name unique within its landmark (radios within their group).
 */

const LANDMARKS = new Set(['banner', 'main', 'navigation', 'contentinfo', 'region', 'complementary', 'form', 'search', 'dialog', 'alertdialog']);
const CONTROLS = new Set(['button', 'link', 'textbox', 'searchbox', 'slider', 'spinbutton', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'row', 'gridcell', 'treeitem']);
const GROUPS = new Set(['group', 'radiogroup']);

/**
 * Duplicated [role, name] pairs per landmark in an ARIA snapshot. Radios are
 * scoped to their group. Returns ["region "Mixer": button "Mute"", …].
 */
function duplicateNames(snapshot) {
  const stack = []; // { indent, role, name }
  const seen = new Map(); // scope key → Set of "role name"
  const dupes = [];
  let uid = 0;
  for (const line of snapshot.split('\n')) {
    const m = /^(\s*)- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    const [, , role, name = ''] = m;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (CONTROLS.has(role) && name) {
      const scopeOf = (set) => [...stack].reverse().find((s) => set.has(s.role));
      const scope = (role === 'radio' && scopeOf(GROUPS)) || scopeOf(LANDMARKS);
      const key = scope ? `${scope.role} "${scope.name}"#${scope.uid}` : 'page';
      const names = seen.get(key) ?? new Set();
      const id = `${role} "${name}"`;
      if (names.has(id)) dupes.push(`${key.replace(/#\d+$/, '')}: ${id}`);
      names.add(id);
      seen.set(key, names);
    }
    stack.push({ indent, role, name, uid: uid++ });
  }
  return [...new Set(dupes)];
}

async function axe(page, label) {
  // WCAG 2.2 AA, including target size (2.5.8), which the default rule set leaves out.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  const summary = results.violations.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary).toEqual([]);
}

async function uniqueNames(page, label) {
  const snapshot = await page.locator('body').ariaSnapshot();
  expect(duplicateNames(snapshot).map((d) => `${label}: ${d}`)).toEqual([]);
}

function wav() {
  const rate = 48000;
  const frames = rate;
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
  for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), 44 + 2 * i);
  return b;
}

test.describe.configure({ timeout: 120_000 });

for (const route of ['/', '/new', '/projects', '/settings', '/no-such-page']) {
  test(`${route}: no axe violations and unique names per landmark`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await axe(page, route);
    await uniqueNames(page, route);
  });
}

test('the editor with every panel open: no axe violations and unique names per landmark', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  await page.locator('input[type="file"][accept^="audio"]').first().setInputFiles([{ name: 'loop.wav', mimeType: 'audio/wav', buffer: wav() }]);
  const clip = page.getByRole('treegrid', { name: 'Tracks and clips' }).locator('[role="row"][aria-level="2"]').filter({ hasText: 'loop' });
  await clip.click();
  await expect(page.getByRole('region', { name: 'Clip properties: loop' })).toBeVisible();
  const tools = page.getByRole('toolbar', { name: 'Clip commands' });
  await tools.getByLabel('Instrument').selectOption('sampler');
  await tools.getByRole('button', { name: 'Add instrument track' }).click();
  await expect(page.getByRole('region', { name: /^Sampler: / })).toBeVisible();
  await axe(page, 'editor');
  await uniqueNames(page, 'editor');
  await page.getByRole('button', { name: /^Track 2: Bass/ }).click();
  await expect(page.getByRole('region', { name: 'Subtractive synth: Bass' })).toBeVisible();
  await axe(page, 'editor, Bass selected');
  await uniqueNames(page, 'editor, Bass selected');
});

test('dialog states: volume notice, export, save preset and delete confirmations', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  await page.getByRole('toolbar', { name: 'Transport' }).getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Volume notice' })).toBeVisible();
  await axe(page, 'volume notice');
  await page.getByRole('alertdialog', { name: 'Volume notice' }).getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('toolbar', { name: 'Project' }).getByRole('button', { name: 'Export' }).click();
  await expect(page.getByRole('dialog', { name: 'Export WAV' })).toBeVisible();
  await axe(page, 'export dialog');
  await page.getByRole('dialog', { name: 'Export WAV' }).getByRole('button', { name: 'Close' }).click();

  await page.getByRole('region', { name: 'Drum machine: Drums' }).getByRole('button', { name: 'Save preset' }).click();
  const save = page.getByRole('dialog', { name: 'Save Drum machine preset' });
  await save.getByRole('button', { name: 'Save preset' }).click();
  await expect(save).toContainText('Enter a preset name.');
  await axe(page, 'save preset dialog with an error');
  await save.getByRole('textbox', { name: 'Name' }).fill('Tight kit');
  await save.getByRole('button', { name: 'Save preset' }).click();
  await expect(save).toBeHidden();

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Rename Tight kit' }).click();
  await axe(page, 'rename preset dialog');
  await page.getByRole('dialog', { name: 'Rename Tight kit' }).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Clear all data' }).click();
  await axe(page, 'clear all data dialog');
  await page.getByRole('dialog', { name: 'Clear all data?' }).getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Doomed');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Doomed');
  await page.goto('/projects');
  await page.getByRole('button', { name: /^Delete Doomed/ }).click();
  await axe(page, 'delete project dialog');
});

test('every primary control is reachable by role and name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'New project' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open .wrack file' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Beat' }).click();
  const transport = page.getByRole('toolbar', { name: 'Transport' });
  for (const name of ['Go to start', 'Play', 'Loop', 'Metronome']) await expect(transport.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Panic' })).toBeVisible();
  const project = page.getByRole('toolbar', { name: 'Project' });
  for (const name of ['Save .wrack file', 'Export']) await expect(project.getByRole('button', { name })).toBeVisible();
  const clips = page.getByRole('toolbar', { name: 'Clip commands' });
  for (const name of ['Add audio file', 'Add audio track', 'Add instrument track', 'Split at edit cursor', 'Join clips', 'Duplicate clip', 'Delete clip']) {
    await expect(clips.getByRole('button', { name })).toBeVisible();
  }
  await expect(page.getByRole('treegrid', { name: 'Tracks and clips' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Master volume' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Master effects' }).getByRole('button', { name: 'Add effect' })).toBeVisible();
});

/**
 * Presses Tab until `target` has focus (at most `max` presses). WebKit on
 * macOS moves Tab focus only between form controls; Alt+Tab includes links.
 */
async function tabTo(page, target, max = 80) {
  const key = page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

test('keyboard only: create a project, play an example through the notice, Panic, save a preset', async ({ page }) => {
  await page.goto('/');
  await tabTo(page, page.getByRole('main').getByRole('link', { name: 'New project' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible();
  const name = page.getByRole('textbox', { name: 'Name' });
  await tabTo(page, name);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Keys only');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Keys only');

  await page.goto('/');
  await tabTo(page, page.getByRole('button', { name: 'Open Beat' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Beat (copy)');
  await page.getByRole('heading', { level: 1 }).click(); // focus outside controls; Space then plays
  await page.keyboard.press('Space');
  const notice = page.getByRole('alertdialog', { name: 'Volume notice' });
  await expect(notice.getByRole('button', { name: 'Continue' })).toBeFocused();
  await page.keyboard.press('Enter');
  const play = page.getByRole('toolbar', { name: 'Transport' }).getByRole('button', { name: 'Play' });
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status').filter({ hasText: 'All sound stopped' })).toHaveCount(1);

  const save = page.getByRole('region', { name: 'Drum machine: Drums' }).getByRole('button', { name: 'Save preset' });
  await tabTo(page, save, 400);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Save Drum machine preset' });
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.type('Keyboard kit');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(save).toBeFocused();
});
