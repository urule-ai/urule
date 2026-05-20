import { test as base, type Page } from '@playwright/test';

/**
 * Authenticated page fixture.
 *
 * Uses the "Demo Login" button to authenticate without needing
 * Keycloak or real credentials. Every test that extends this
 * fixture starts on the dashboard as "Demo User".
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    // Navigate to login
    await page.goto('/login');

    // Click "Demo Login" button
    await page.getByRole('button', { name: /demo login/i }).click();

    // Wait for redirect to dashboard
    await page.waitForURL('**/office**', { timeout: 10000 });

    // Wait until the office layout has fully committed (auth hydration
    // resolved, setup-status check settled, AppHeader + dashboard mounted).
    // `dashboard-stats` is a stable testid on the stat grid (added in #76)
    // that only renders once the layout's `authHydrated && isAuthenticated
    // && setupChecked` gate flips true. Without this, tests that follow
    // race the layout's first render in CI where the setup-status API
    // call takes a beat to time out / catch. (#65)
    await page
      .getByTestId('dashboard-stats')
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {
        // Some tests don't land on the dashboard root (e.g. demo-login
        // could in principle deep-link); swallow so those tests can
        // still take over and do their own waits.
      });

    await use(page);
  },
});

export { expect } from '@playwright/test';
