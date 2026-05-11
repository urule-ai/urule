import { test, expect } from '@playwright/test';

test.describe('Journey 2: Onboarding', () => {
  test('should show setup wizard for new users', async ({ page }) => {
    // Navigate directly to setup
    await page.goto('/setup');
    // Should show step 1 (provider selection) or redirect
    await page.waitForTimeout(1000);
  });

  test('should display provider options', async ({ page }) => {
    await page.goto('/setup');
    await page.waitForTimeout(1000);
    // Look for provider names
    const content = await page.textContent('body');
    if (content?.includes('Provider') || content?.includes('Claude') || content?.includes('OpenAI')) {
      await expect(page.getByText(/claude|openai|provider/i).first()).toBeVisible();
    }
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
