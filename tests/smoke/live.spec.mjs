import { test, expect } from '@playwright/test';

// Checks the live site: the deployed commit is the one being served, the page boots without errors,
// and a real song lookup on iTunes works end to end.
test('the live site serves this commit and can start a round', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

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

  await page.fill('#plName', 'Smoke test');
  await page.fill('#plText', 'The Killers - Mr. Brightside');
  await page.click('#plAdd');
  await expect(page.locator('#plMsg')).toHaveText('Added 1 song.');
  await page.locator('.srcrow', { hasText: 'Smoke test' }).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#board')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#status')).toBeHidden();
  expect(errors).toEqual([]);
});
