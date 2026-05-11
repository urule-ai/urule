import { test, expect } from './fixtures/auth';

test.describe('Journey 3: Dashboard', () => {
  test('should load dashboard after demo login', async ({ authenticatedPage: page }) => {
    await expect(page).toHaveURL(/office/);
  });

  test('should display stat cards', async ({ authenticatedPage: page }) => {
    const statCards = page.getByTestId('dashboard-stats');

    await expect(statCards.getByText('Total Agents', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(statCards.getByText('Active Now', { exact: true })).toBeVisible();
    await expect(statCards.getByText('Pending Approvals', { exact: true })).toBeVisible();
    await expect(statCards.getByText('Offline', { exact: true })).toBeVisible();
  });

  test('should show agent activity section', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('heading', { name: /live agent activity/i })).toBeVisible({ timeout: 15000 });
  });

  test('should navigate to agents page via quick action', async ({ authenticatedPage: page }) => {
    await page.getByRole('link', { name: /agent directory/i }).click();
    await page.waitForURL('**/agents**');
  });

  test('should show infrastructure tab', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /infrastructure/i }).click();
    await expect(page.getByText('Cluster Overview')).toBeVisible({ timeout: 5000 });
  });
});
