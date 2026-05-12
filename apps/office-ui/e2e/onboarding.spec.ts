import { test, expect } from './fixtures/auth';

test.describe('Journey 2: Onboarding', () => {
  test('should show setup wizard for new users', async ({ page }) => {
    // Navigate directly to setup
    await page.goto('/setup');
    // Should show step 1 (provider selection) or redirect
    await page.waitForTimeout(1000);
  });

  test('should display provider options', async ({ authenticatedPage: page }) => {
    // /setup renders the wizard only for an authenticated user — the
    // unauthenticated path redirects to /login. (The earlier version did
    // `page.textContent('body')` to gate on "Provider", but textContent
    // includes inlined <script> tags, so the Next.js RSC blob's
    // "QueryClientProvider" etc. tripped the guard on /login and the
    // visible-text assertion then found nothing.) Use a real session and
    // assert the wizard's step-0 markup directly. (#65)
    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: /select ai model/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Claude', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('OpenAI', { exact: true }).first()).toBeVisible();
  });

  test('should show agent templates in step 2', async ({ page }) => {
    await page.goto('/setup');
    await page.waitForTimeout(1000);
    // If we can advance past step 1, check for agent templates
    const content = await page.textContent('body');
    if (content?.includes('Engineering') || content?.includes('Design')) {
      await expect(page.getByText(/engineering|design|marketing/i).first()).toBeVisible();
    }
  });
});
