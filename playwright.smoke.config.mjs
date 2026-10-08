import { defineConfig, devices } from '@playwright/test';

// Smoke test of the deployed site, with the real network. Runs after each deploy.
export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 120_000,
  retries: 2,   // real iTunes/Spotify calls: retry transient failures, but a page that won't boot still fails
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { ...devices['Desktop Chrome'], baseURL: process.env.SITE_URL || 'https://larmo465.github.io/PlayCount/', trace: 'retain-on-failure' },
});
