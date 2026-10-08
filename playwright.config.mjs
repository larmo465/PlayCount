import { defineConfig, devices } from '@playwright/test';

// Hermetic tests: the network is mocked (tests/support/network.mjs), so these are deterministic and
// gate every deploy. The live-site smoke test has its own config (playwright.smoke.config.mjs).
export default defineConfig({
  testDir: 'tests',
  testIgnore: 'smoke/**',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
});
