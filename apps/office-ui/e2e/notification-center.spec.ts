import { test, expect } from './fixtures/auth';

test.describe('Journey 10: Notification Center', () => {
  test.describe('10.1 Bell + panel', () => {
    // TODO(#65): chromium spec broken since 2026-05-04; see issue for failure trace.
    test.fixme('bell is present in the header', async ({ authenticatedPage: page }) => {
      await page.goto('/office');
      await page.waitForTimeout(800);
      await expect(page.getByTestId('notification-bell')).toBeVisible();
    });

    // TODO(#65): chromium spec broken since 2026-05-04; see issue for failure trace.
    test.fixme('clicking the bell toggles the notification panel', async ({ authenticatedPage: page }) => {
      await page.goto('/office');
      await page.waitForTimeout(800);
      const bell = page.getByTestId('notification-bell');
      await bell.click();
      await expect(page.getByTestId('notification-center')).toBeVisible();
      await bell.click();
      await expect(page.getByTestId('notification-center')).not.toBeVisible();
    });

    // TODO(#65): chromium spec broken since 2026-05-04; see issue for failure trace.
    test.fixme('Escape closes the panel', async ({ authenticatedPage: page }) => {
      await page.goto('/office');
      await page.waitForTimeout(800);
      await page.getByTestId('notification-bell').click();
      await expect(page.getByTestId('notification-center')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('notification-center')).not.toBeVisible();
    });

    // TODO(#65): chromium spec broken since 2026-05-04; see issue for failure trace.
    test.fixme('empty state surfaces when there are no notifications', async ({ authenticatedPage: page }) => {
      await page.goto('/office');
      // Reset persisted state from prior test runs.
      await page.evaluate(() => {
        try {
          localStorage.removeItem('urule-notification-center');
        } catch { /* ignore */ }
      });
      await page.reload();
      await page.waitForTimeout(800);
      await page.getByTestId('notification-bell').click();
      const panel = page.getByTestId('notification-center');
      await expect(panel).toBeVisible();
      await expect(panel.getByText(/No notifications yet/i)).toBeVisible();
    });
  });

  test.describe('10.2 Capture + read state', () => {
    // TODO(#65): chromium spec broken since 2026-05-04; see issue for failure trace.
    test.fixme('a programmatic toast surfaces in the notification list', async ({ authenticatedPage: page }) => {
      await page.goto('/office');
      // Reset persisted state.
      await page.evaluate(() => {
        try { localStorage.removeItem('urule-notification-center'); } catch { /* ignore */ }
      });
      await page.reload();
      await page.waitForTimeout(800);

      // Push a toast directly into the store via the page's window.
      // The capture hook mirrors it into the center. Both stores live in
      // module scope so we expose them through the React DevTools-style
      // `window` interface — fall back to dispatching a custom event the
      // app already wires up if present.
      await page.evaluate(() => {
        // Direct add via the notification center store — proves the
        // panel renders new entries even if the toast pipeline isn't
        // exercised in this synthetic test path.
        const w = window as unknown as {
          __ZUSTAND_NOTIFICATION_CENTER__?: { add: (e: unknown) => void };
        };
        // Fallback: write directly to the persisted localStorage shape.
        const existing = localStorage.getItem('urule-notification-center');
        const state = existing ? JSON.parse(existing) : { state: { notifications: [] }, version: 0 };
        state.state.notifications = [
          {
            id: 't1',
            kind: 'info',
            title: 'E2E test notification',
            body: 'Synthetic body',
            createdAt: new Date().toISOString(),
            read: false,
            source: 'e2e',
          },
          ...state.state.notifications,
        ];
        localStorage.setItem('urule-notification-center', JSON.stringify(state));
      });
      await page.reload();
      await page.waitForTimeout(800);
      await page.getByTestId('notification-bell').click();
      const panel = page.getByTestId('notification-center');
      await expect(panel.getByText('E2E test notification')).toBeVisible();
      await expect(page.getByTestId('notification-badge')).toBeVisible();
    });

    // TODO(#65): chromium spec broken since 2026-05-04; see issue for failure trace.
    test.fixme('clear all removes every entry', async ({ authenticatedPage: page }) => {
      await page.goto('/office');
      // Seed a notification then clear it via the UI.
      await page.evaluate(() => {
        localStorage.setItem('urule-notification-center', JSON.stringify({
          state: {
            notifications: [
              { id: 't1', kind: 'info', title: 'Will be cleared', createdAt: new Date().toISOString(), read: false },
            ],
          },
          version: 0,
        }));
      });
      await page.reload();
      await page.waitForTimeout(800);
      await page.getByTestId('notification-bell').click();
      await page.getByTestId('notification-clear-all').click();
      await expect(page.getByTestId('notification-center').getByText(/No notifications yet/i)).toBeVisible();
    });
  });
});
