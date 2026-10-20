import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const ROUTES = [
  { path: '/', heading: 'Wrack', current: 'Home' },
  { path: '/new', heading: 'New project', current: 'New project' },
  { path: '/projects', heading: 'Projects', current: 'Projects' },
  { path: '/settings', heading: 'Settings', current: 'Settings' },
  { path: '/projects/prj_routes-test', heading: 'Project not found', current: null },
  { path: '/projects/_shell', heading: 'Project not found', current: null },
  { path: '/no-such-page', heading: 'Page not found', current: null, status: 404 },
];

// WebKit on macOS moves Tab focus only between form controls; Alt+Tab includes links.
const tabKey = (browserName) => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');

for (const route of ROUTES) {
  test.describe(route.path, () => {
    test('has landmarks, one h1 and no axe violations', async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response.status()).toBe(route.status ?? 200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('banner')).toHaveCount(1);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test('marks only the current location in the header', async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading);
      const nav = page.getByRole('navigation', { name: 'Main' });
      const current = nav.locator('[aria-current="page"]');
      if (route.current) {
        await expect(current).toHaveCount(1);
        await expect(current).toHaveText(route.current);
      } else {
        await expect(current).toHaveCount(0);
      }
    });

    test('skip link comes first and Tab reaches the navigation', async ({ page, browserName }) => {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading);
      await page.keyboard.press(tabKey(browserName));
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
      await page.keyboard.press(tabKey(browserName));
      await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' })).toBeFocused();
    });
  });
}

test('the skip link moves focus to main', async ({ page, browserName }) => {
  await page.goto('/projects');
  await page.keyboard.press(tabKey(browserName));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('an unknown project links to Projects and New project', async ({ page }) => {
  await page.goto('/projects/_shell');
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects');
  await expect(main.getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/new');
});

test('any /projects/<id> serves the editor shell', async ({ page }) => {
  const response = await page.goto('/projects/prj_another-id');
  expect(response.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Project not found');
});

test('in the editor the header marks Projects as the current section and leads back to the list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  await expect(page.getByRole('treegrid', { name: 'Tracks and clips' })).toBeVisible();
  const projects = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Projects' });
  await expect(projects).toHaveAttribute('aria-current', 'true');
  await projects.click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(projects).toHaveAttribute('aria-current', 'page');
});

test('editor skip links lead past the toolbars to the tracks and the piano roll', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Beat' }).click();
  const tree = page.getByRole('treegrid', { name: 'Tracks and clips' });
  await expect(tree).toBeVisible();
  const toTracks = page.getByRole('button', { name: 'Skip to tracks and clips' });
  const toRoll = page.getByRole('button', { name: 'Skip to the piano roll' });
  // Both come right after the site header, ahead of the editor header and the transport.
  const goToStart = page.getByRole('toolbar', { name: 'Transport' }).getByRole('button', { name: 'Go to start' });
  const [a, b, c] = await Promise.all([toTracks, toRoll, goToStart].map((l) => l.elementHandle()));
  const precedes = (x, y) => x.evaluate((el, other) => Boolean(el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING), y);
  expect(await precedes(a, b)).toBe(true);
  expect(await precedes(b, c)).toBe(true);
  await toTracks.focus();
  await expect(toTracks).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="treegrid"]')))).toBe(true);
  await toRoll.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="grid"][aria-label="Notes"]')))).toBe(true);
});

test('header links navigate between routes', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Projects');
  await expect(nav.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New project');
});
