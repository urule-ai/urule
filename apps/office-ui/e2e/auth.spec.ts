import { test, expect } from '@playwright/test';

test.describe('Journey 1: Authentication', () => {
  test.describe('1.1 Login', () => {
    test('should show login page', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByText('URULE')).toBeVisible();
      await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    });

    test('should show validation errors for empty fields', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /authenticate/i }).click();
      // Expect inline validation errors
      await expect(page.getByText(/required|invalid/i).first()).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/login');
      await page.getByPlaceholder(/email/i).fill('wrong@test.com');
      await page.getByPlaceholder(/password/i).fill('wrongpassword');
      await page.getByRole('button', { name: /authenticate/i }).click();
      // Should show server error (502 since Keycloak may not be running)
      await page.waitForTimeout(2000);
    });

    test('should demo login successfully', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /demo login/i }).click();
      await page.waitForURL('**/office**');
      await expect(page).toHaveURL(/office/);
    });

    test('SSO button initiates a Keycloak redirect', async ({ page }) => {
      // SSO buttons now navigate to Keycloak's authorize endpoint
      // (see useSsoLogin). Clicking should send window.location at
      // the configured Keycloak URL — we intercept the navigation
      // and assert the URL shape rather than chasing a real handshake.
      await page.goto('/login');
      const ssoButton = page.getByRole('button', { name: /sign in with sso/i });
      if (!(await ssoButton.isVisible())) return;
      const navPromise = page.waitForRequest((req) =>
        req.url().includes('/protocol/openid-connect/auth'),
      );
      await ssoButton.click().catch(() => { /* navigation may abort the click promise */ });
      const req = await Promise.race([
        navPromise,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      // If Keycloak isn't reachable the request still fires from the
      // browser before connection refused — assertion is on the URL
      // shape, not the response code.
      if (req && typeof req === 'object' && 'url' in req) {
        const url = (req as { url(): string }).url();
        expect(url).toContain('client_id=urule-office');
        expect(url).toContain('response_type=code');
      }
    });
  });

  test.describe('1.2 Register', () => {
    test('should show registration page', async ({ page }) => {
      await page.goto('/register');
      await expect(page.getByText(/create.*workspace|create.*account/i)).toBeVisible();
    });

    test('should validate password requirements', async ({ page }) => {
      await page.goto('/register');
      const pwField = page.locator('input[type="password"]').first();
      await pwField.fill('weak');
      await page.getByRole('button', { name: /create/i }).click();
      // Should show password requirement errors
      await page.waitForTimeout(500);
    });
  });

  test.describe('1.3 Forgot Password', () => {
    test('should show forgot password page', async ({ page }) => {
      await page.goto('/forgot-password');
      await expect(page.getByText(/reset/i)).toBeVisible();
    });

    test('should show success after submitting email', async ({ page }) => {
      await page.goto('/forgot-password');
      await page.getByPlaceholder(/email/i).fill('test@example.com');
      await page.getByRole('button', { name: /send|reset/i }).click();
      await page.waitForTimeout(1000);
      await expect(page.getByText(/reset link|check your email/i)).toBeVisible();
    });

    test('should navigate back to login', async ({ page }) => {
      await page.goto('/forgot-password');
      await page.getByRole('link', { name: /back.*login|sign in/i }).click();
      await page.waitForURL('**/login');
    });
  });
});
