import { expect, test } from '@playwright/test';

/*
 * Data saved under the app's former name, "w-rack", moves to "wrack" on the
 * next visit: localStorage keys and the IndexedDB database of stored audio.
 */

const keys = (page) => page.evaluate(() => Object.keys(localStorage).sort());

test('projects, settings and stored audio saved as "w-rack" carry over as "wrack"', async ({ page }) => {
  await page.goto('/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Kept');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kept');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();

  // Write the data back under the former names, as an earlier version saved it.
  await page.goto('/settings');
  await page.evaluate(async () => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('wrack:')) continue;
      localStorage.setItem(`w-rack:${key.slice('wrack:'.length)}`, localStorage.getItem(key));
      localStorage.removeItem(key);
    }
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('w-rack', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sources', { keyPath: 'sourceId' });
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('sources', 'readwrite');
        tx.objectStore('sources').put({ sourceId: 'src_legacy', name: 'legacy.wav', mimeType: 'audio/wav', size: 4, sha256: 'x', bytes: new Uint8Array([82, 73, 70, 70]).buffer });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(new Error(`legacy put failed: ${tx.error}`));
      };
      request.onerror = () => reject(new Error(`legacy open failed: ${request.error}`));
    });
  });
  expect((await keys(page)).every((k) => !k.startsWith('wrack:'))).toBe(true);

  await page.reload();
  await expect(page.getByRole('list', { name: 'Stored audio files' })).toContainText('legacy.wav');
  await expect.poll(async () => (await keys(page)).filter((k) => k.startsWith('w-rack:'))).toEqual([]);
  expect(await keys(page)).toContain('wrack:v1:index');
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort())).not.toContain('w-rack');

  await page.goto('/projects');
  await expect(page.getByRole('list', { name: 'Saved projects' })).toContainText('Kept');
});
