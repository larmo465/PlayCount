import { defineConfig, devices } from '@playwright/test';

// Trailing slash so relative paths like './' resolve inside the site, not next to it.
const SITE_URL = (process.env.SITE_URL || 'https://larmo465.github.io/PlayCount/').replace(/\/?$/, '/');

// Smoke test of the deployed site, with the real network. Runs after each deploy.
export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 120_000,
  retries: 2,   // real iTunes/Spotify calls: retry transient failures, but a page that won't boot still fails
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Real Google Chrome by default: unlike Playwright's Chromium it can decode the AAC song previews.
  // SMOKE_BROWSER=chromium runs it in Playwright's Chromium instead (previews become a test tone).
  use: {
    ...devices['Desktop Chrome'], baseURL: SITE_URL, trace: 'retain-on-failure',
    channel: process.env.SMOKE_BROWSER === 'chromium' ? undefined : 'chrome',
  },
});
