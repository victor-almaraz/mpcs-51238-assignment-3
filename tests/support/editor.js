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
