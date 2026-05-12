import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests run with auth bypassed (mock admin user); the auth
    // layer is exercised separately in @urule/auth-middleware + the auth-401
    // specs (which set skipAuth:false to stay immune to this).
    env: { SKIP_AUTH: 'true' },
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
  },
});
