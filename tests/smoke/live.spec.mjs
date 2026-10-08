import { test, expect } from '@playwright/test';
import { toneWav } from '../support/network.mjs';

// Checks the live site: the deployed commit is the one being served, the page boots without errors,
// and a real song lookup on iTunes works end to end.
test('the live site serves this commit and can start a round', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Keep CI's visits out of the Umami stats (Umami's own opt-out switch).
  await page.addInitScript(() => localStorage.setItem('umami.disabled', '1'));

  const expected = process.env.EXPECTED_BUILD;
  if (expected) {
    // GitHub Pages can take a moment to serve a new deploy.
    await expect.poll(async () => {
      await page.goto('./?v=' + Date.now());
      return page.getAttribute('meta[name="build"]', 'content');
    }, { timeout: 90_000, intervals: [5_000] }).toBe(expected);
  } else {
    await page.goto('./');
  }
  await expect(page).toHaveTitle('PlayCount');

  // CI runs this in Google Chrome, which plays the real AAC previews. Playwright's own Chromium can't,
  // so there the preview is swapped for a test tone and only the rest of the flow is checked.
  const realAudio = await page.evaluate(() => !!new Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"'));
  if (!realAudio) {
    test.info().annotations.push({ type: 'note', description: 'No AAC decoder in this browser: previews replaced by a test tone.' });
    await page.route(u => u.host.startsWith('audio-ssl.') || u.pathname.endsWith('.m4a'),
      r => r.fulfill({ status: 200, contentType: 'audio/wav', body: toneWav() }));
  }

  await page.fill('#plName', 'Smoke test');
  await page.fill('#plText', 'The Killers - Mr. Brightside');
  await page.click('#plAdd');
  await expect(page.locator('#plMsg')).toContainText('Added 1 song');
  await page.locator('.srcrow', { hasText: 'Smoke test' }).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#board')).toBeVisible({ timeout: 30_000 });
  // The play button is enabled once the song preview has loaded and can be played.
  await expect(page.locator('#playBtn')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#status')).toBeHidden();
  expect(errors).toEqual([]);
});
