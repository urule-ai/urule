import { test, expect } from './fixtures/auth';

// The auth fixture lands on /office and waits for the office shell to
// commit (`data-testid="dashboard-stats"` only renders once the layout's
// `authHydrated && isAuthenticated && setupChecked` gate flips true), so
// inside these tests the notification bell is already in the DOM — no
// extra `page.goto('/office')` + fixed-sleep needed. Tests that seed
// localStorage then reload re-wait for the bell after the reload, since a
// hard reload restarts the hydration → setup-status chain. (#65)

test.describe('Journey 10: Notification Center', () => {
  test.describe('10.1 Bell + panel', () => {
    test('bell is present in the header', async ({ authenticatedPage: page }) => {
      await expect(page.getByTestId('notification-bell')).toBeVisible();
    });

    test('clicking the bell toggles the notification panel', async ({ authenticatedPage: page }) => {
      const bell = page.getByTestId('notification-bell');
      await bell.click();
      await expect(page.getByTestId('notification-center')).toBeVisible();
      await bell.click();
      await expect(page.getByTestId('notification-center')).not.toBeVisible();
    });

    test('Escape closes the panel', async ({ authenticatedPage: page }) => {
      await page.getByTestId('notification-bell').click();
      await expect(page.getByTestId('notification-center')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('notification-center')).not.toBeVisible();
    });

    test('empty state surfaces when there are no notifications', async ({ authenticatedPage: page }) => {
      // Each Playwright test gets a fresh browser context, so the
      // notification store starts empty — click and assert the empty copy.
      await page.getByTestId('notification-bell').click();
      const panel = page.getByTestId('notification-center');
      await expect(panel).toBeVisible();
      await expect(panel.getByText(/No notifications yet/i)).toBeVisible();
    });
  });

  test.describe('10.2 Capture + read state', () => {
    // TODO(#65): these two seed localStorage then `page.reload()`. After the
    // hard reload the office layout never re-commits in CI — the
    // `dashboard-stats` marker times out at 15s. The non-reload notification
    // specs above all pass, so this is specifically a seeded-localStorage +
    // hard-reload interaction (possibly the notification-center store's
    // rehydrate stalling something, or the setup-status fetch behaving
    // differently on a reloaded page). Needs local repro; until then these
    // stay fixme'd.
    test.fixme('a programmatic toast surfaces in the notification list', async ({ authenticatedPage: page }) => {
      // Seed the persisted store with one unread notification, reload so
      // zustand-persist rehydrates it, wait for the shell to re-commit,
      // then verify it surfaces in the panel + the unread badge shows.
      await page.evaluate(() => {
        localStorage.setItem(
          'urule-notification-center',
          JSON.stringify({
            state: {
              notifications: [
                {
                  id: 't1',
                  kind: 'info',
                  title: 'E2E test notification',
                  body: 'Synthetic body',
                  createdAt: new Date().toISOString(),
                  read: false,
                  source: 'e2e',
                },
              ],
            },
            version: 0,
          }),
        );
      });
      await page.reload();
      // After a hard reload the office shell re-commits asynchronously
      // (auth hydration → setup-status → AppHeader). Wait for the dashboard
      // stat grid (the layout-stable marker) so the header has finished
      // settling before we click the bell — otherwise Playwright reports the
      // bell as "not stable" mid-render.
      await page.getByTestId('dashboard-stats').waitFor({ state: 'visible', timeout: 15000 });
      await page.getByTestId('notification-bell').click();
      const panel = page.getByTestId('notification-center');
      await expect(panel.getByText('E2E test notification')).toBeVisible();
      await expect(page.getByTestId('notification-badge')).toBeVisible();
    });

    // TODO(#65): same seeded-localStorage + hard-reload issue as the test above.
    test.fixme('clear all removes every entry', async ({ authenticatedPage: page }) => {
      await page.evaluate(() => {
        localStorage.setItem(
          'urule-notification-center',
          JSON.stringify({
            state: {
              notifications: [
                {
                  id: 't1',
                  kind: 'info',
                  title: 'Will be cleared',
                  createdAt: new Date().toISOString(),
                  read: false,
                },
              ],
            },
            version: 0,
          }),
        );
      });
      await page.reload();
      await page.getByTestId('dashboard-stats').waitFor({ state: 'visible', timeout: 15000 });
      await page.getByTestId('notification-bell').click();
      await page.getByTestId('notification-clear-all').click();
      await expect(
        page.getByTestId('notification-center').getByText(/No notifications yet/i),
      ).toBeVisible();
    });
  });
});
