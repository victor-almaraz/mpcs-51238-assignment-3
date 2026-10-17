/*
 * End-to-end helpers for the editor workspace: track rows in the "Tracks and
 * clips" treegrid (the track headers) and the dock's tabs.
 */

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The track row whose name starts with `label` ("Track 2: Bass, Subtractive synth"). */
export function trackRow(page, label) {
  return page.getByRole('treegrid', { name: 'Tracks and clips' }).getByRole('row', { name: new RegExp(`^${escape(label)}`) });
}

/** Selects a track by clicking its header. */
export async function selectTrack(page, label) {
  await trackRow(page, label).click({ position: { x: 60, y: 20 } });
}

/** Opens a dock tab: 'Editor', 'Devices' or 'Mixer'. */
export async function openTab(page, name) {
  await page.getByRole('tablist', { name: 'Panels' }).getByRole('tab', { name }).click();
}

/** Opens menu button `menu` ("File", "Add", "Edit") and returns its menu item named `item`. */
export async function menuItem(page, menu, item) {
  await page.getByRole('button', { name: menu, exact: true }).click();
  return page.getByRole('menu', { name: menu }).getByRole('menuitem', { name: item, exact: true });
}

/** Adds an instrument track of label `instrument` ("Sampler", "Pluck synth") through the Add menu. */
export async function addInstrumentTrack(page, instrument) {
  await (await menuItem(page, 'Add', `${instrument} track`)).click();
}
