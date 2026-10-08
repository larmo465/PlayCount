import { test as base, expect } from '@playwright/test';
import { mockNetwork, APP_URL, FILE_URL } from './support/network.mjs';
import { SONGS, TOTAL_PLAYS, ROAD_TRIP, historyFile, basicHistoryFile, exportZip, csvFile, PASTE } from './support/data.mjs';

// Every test gets the mocked network, a seeded Math.random (so song picks, and therefore the
// recorded lookups they need, are the same on every run), and fails on page errors or unmocked requests.
const test = base.extend({
  netOptions: [{}, { option: true }],
  randomSeq: [[], { option: true }],     // values Math.random returns first, before the seeded sequence
  net: [async ({ page, netOptions, randomSeq }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.addInitScript(seq => {
      let a = 20261008;
      const prng = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      Math.random = () => seq.length ? seq.shift() : prng();
    }, randomSeq);
    const log = await mockNetwork(page, netOptions);
    await use(log);
    expect(errors, 'uncaught errors in the page').toEqual([]);
    expect(log.unexpected, 'requests to hosts the tests do not mock').toEqual([]);
  }, { auto: true }],
});

async function loadFiles(page, ...files) {
  await page.setInputFiles('#file', files);
  await expect(page.locator('#sources')).toBeVisible();
}
async function play(page, source) {
  await page.locator('.srcrow', { hasText: source }).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#board')).toBeVisible();
}
async function pasteSongs(page, name, text) {
  await page.fill('#plName', name);
  await page.fill('#plText', text);
  await page.click('#plAdd');
  await expect(page.locator('#plMsg')).toContainText(/Added|Couldn't/);
}
async function giveUp(page) {
  while (!(await page.isVisible('#resultPanel'))) await page.click('#skipBtn');
  await expect(page.locator('#resultPanel')).toBeVisible();
  return { title: await page.textContent('#revTitle'), artist: await page.textContent('#revArtist'), info: await page.textContent('#revPlays') };
}
async function nextSong(page) {
  await page.click('#nextBtn');
  await expect(page.locator('#board')).toBeVisible();
}
async function guess(page, text) {
  await page.fill('#guess', text);
  await expect(page.locator('#sugg li').first()).toBeVisible();
  await page.keyboard.press('Enter');
}
const slotKinds = page => page.$$eval('.slot', l => l.map(s => s.className.replace('slot', '').trim()));
async function setRange(page, selector, value) {
  await page.$eval(selector, (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); }, String(value));
}

test.describe('listening history', () => {
  test.beforeEach(async ({ page }) => { await page.goto(APP_URL); });

  test('imports the extended export, counting only plays of 30 s or more', async ({ page }) => {
    await loadFiles(page, historyFile());
    await expect(page.locator('#loadMsg')).toHaveText(
      `Loaded ${TOTAL_PLAYS} plays of ${SONGS.length} songs (${TOTAL_PLAYS + SONGS.length} streams, extended history).`);
  });

  test('imports the one-year export format too', async ({ page }) => {
    await loadFiles(page, basicHistoryFile());
    await expect(page.locator('#loadMsg')).toHaveText('Loaded 2 plays of 1 song (3 streams, last-year history).');
  });

  test('weights songs by play count, adjustable in settings', async ({ page }) => {
    await loadFiles(page, historyFile());
    await play(page, 'My listening history');
    await page.click('#settingsBtn');
    const rows = page.locator('#topTable tr');
    await expect(rows.first()).toContainText('Mr. Brightside — The Killers60 plays');
    await expect(rows.nth(1)).toContainText('Bohemian Rhapsody - Remastered 2011 — Queen25 plays');
    // The pool can shrink while we look (a background lookup may drop a song with no preview), so check
    // proportions rather than exact totals: chance is proportional to plays.
    const pct = async i => parseFloat((await rows.nth(i).locator('td').last().textContent()));
    expect((await pct(0)) / (await pct(1))).toBeCloseTo(60 / 25, 1);
    await setRange(page, '#exp', 0);
    const poolSize = parseInt(await page.textContent('#poolInfo'), 10);
    await expect(rows.first()).toContainText(`${(100 / poolSize).toFixed(2)}%`);
    await expect(page.locator('#expLabel')).toHaveText('Every song equally likely');
    await page.fill('#minPlays', '10');
    await page.locator('#minPlays').dispatchEvent('change');
    await expect(page.locator('#poolInfo')).toHaveText(`3 of ${SONGS.length} songs in the pool.`);
  });

  test('the first clip stops after half a second', async ({ page }) => {
    await page.addInitScript(() => {
      window.__stops = [];
      const pause = HTMLMediaElement.prototype.pause;
      HTMLMediaElement.prototype.pause = function () { if (!this.paused) window.__stops.push(this.currentTime); return pause.call(this); };
    });
    await page.reload();
    await loadFiles(page, historyFile());
    await play(page, 'My listening history');
    await expect(page.locator('#playBtn')).toBeEnabled();
    await page.click('#playBtn');
    await expect.poll(() => page.evaluate(() => window.__stops.length)).toBe(1);
    const stoppedAt = await page.evaluate(() => window.__stops[0]);
    expect(stoppedAt).toBeGreaterThanOrEqual(0.45);
    expect(stoppedAt).toBeLessThan(0.8);
  });

  test('wrong guesses and skips unlock more of the song, then it is revealed', async ({ page }) => {
    await loadFiles(page, historyFile());
    await play(page, 'My listening history');
    await expect(page.locator('#skipBtn')).toHaveText('Skip (+0.5s)');
    await page.click('#skipBtn');
    await expect(page.locator('#skipBtn')).toHaveText('Skip (+1s)');
    const r = await giveUp(page);
    await expect(page.locator('#outcome')).toHaveText('Out of guesses.');
    const song = SONGS.find(s => s[0] === r.title);
    expect(song, `revealed "${r.title}" should come from the history`).toBeTruthy();
    expect(r.info).toContain(`You've played this ${song[2]} time`);
    expect(await slotKinds(page)).toEqual(['skip', 'skip', 'skip', 'skip', 'skip', 'skip']);
  });

  test('picks are spread across songs, and none repeats back to back', async ({ page }) => {
    await loadFiles(page, historyFile());
    await play(page, 'My listening history');
    const seen = [(await giveUp(page)).title];
    for (let i = 0; i < 5; i++) { await nextSong(page); seen.push((await giveUp(page)).title); }
    for (let i = 1; i < seen.length; i++) expect(seen[i], `round ${i + 1}`).not.toBe(seen[i - 1]);
    expect(new Set(seen).size).toBeGreaterThan(2);
  });
});

test.describe('history pool', () => {
  test.use({ randomSeq: [0.95] });   // 0.95 × 115 = 109 lands on "Zzz…" in the cumulative weights

  test('drops a song iTunes has no preview for', async ({ page, net }) => {
    await page.goto(APP_URL);
    await loadFiles(page, historyFile());
    await play(page, 'My listening history');
    expect(net.itunes[0].term).toBe('Zzz Nonexistent Track Qwerty No Such Artist 123');
    await page.click('#settingsBtn');
    await expect(page.locator('#poolInfo')).toHaveText(`${SONGS.length - 1} of ${SONGS.length} songs in the pool.`);
  });
});

test.describe('playlists', () => {
  test.beforeEach(async ({ page }) => { await page.goto(APP_URL); });

  test('imports history, playlists and Liked Songs from the export zip, and a CSV', async ({ page }) => {
    await loadFiles(page, await exportZip());
    await expect(page.locator('#loadMsg')).toContainText('and 2 playlists.');
    await page.setInputFiles('#file', [csvFile()]);
    await expect(page.locator('.srcrow .sn')).toHaveText(['My listening history', 'Road Trip', 'Liked Songs', 'Gym Mix']);
    await expect(page.locator('.srcrow', { hasText: 'Road Trip' })).toContainText('3 songs, shuffled');
    await expect(page.locator('.srcrow', { hasText: 'Gym Mix' })).toContainText('3 songs, shuffled');
  });

  test('imports pasted links and lines, and skips playlist links', async ({ page }) => {
    await pasteSongs(page, 'Pasted', PASTE);
    await expect(page.locator('#plMsg')).toHaveText('Added 4 songs. Skipped 1 non-track link.');
  });

  test('shuffle plays every song once before repeating', async ({ page }) => {
    await loadFiles(page, await exportZip());
    await play(page, 'Road Trip');
    await expect(page.locator('#sourceTag')).toHaveText('Shuffling Road Trip');
    const seen = [];
    for (let i = 0; i < ROAD_TRIP.length; i++) {
      if (i) await nextSong(page);
      seen.push((await giveUp(page)).title);
    }
    expect([...seen].sort()).toEqual([...ROAD_TRIP].sort());
    await expect(page.locator('#revPlays')).toContainText('Last song of this shuffle');
  });

  test('guessing: wrong artist is red, right artist yellow, and a match across sources wins', async ({ page }) => {
    await loadFiles(page, historyFile());
    await pasteSongs(page, 'Just Dreams', 'Fleetwood Mac - Dreams');
    await play(page, 'Just Dreams');
    await guess(page, 'brightside');
    await guess(page, 'go your own');
    await guess(page, 'dreams');   // the history entry "Dreams - 2004 Remaster" is the same song
    await expect(page.locator('#outcome')).toHaveText('Got it in 3.');
    expect(await slotKinds(page)).toEqual(['wrong', 'close', 'right', '', '', '']);
    await expect(page.locator('#revPlays')).toContainText("You've played this 12 times");
  });

  test('artists of pasted links are looked up in the background and become searchable', async ({ page }) => {
    await page.addInitScript(() => { window.__PC_BG_INTERVAL__ = 50; });
    await page.reload();
    await pasteSongs(page, 'Links', PASTE);
    await play(page, 'Links');
    await expect(page.locator('#sourceTag')).toHaveText('Shuffling Links', { timeout: 15000 });
    await page.fill('#guess', 'queen');
    await expect(page.locator('#sugg li')).toHaveText(['Bohemian Rhapsody — Queen']);
    await page.fill('#guess', 'killers');
    await expect(page.locator('#sugg li')).toHaveText(['Mr. Brightside — The Killers']);
  });

  test('playlists and history survive a reload', async ({ page }) => {
    await loadFiles(page, await exportZip());
    await play(page, 'Road Trip');
    await page.reload();
    await expect(page.locator('#board')).toBeVisible();
    await page.click('#settingsBtn');
    await expect(page.locator('#sourceSel option')).toHaveText(['My listening history', 'Road Trip (shuffle)', 'Liked Songs (shuffle)']);
  });
});

test.describe('song lookups', () => {
  test('use fetch on a normal web page', async ({ page, net }) => {
    await page.goto(APP_URL);
    await loadFiles(page, historyFile());
    await play(page, 'My listening history');
    expect(net.itunes.map(r => r.via)).not.toContain('jsonp');
  });

  test.describe('when iTunes leaves out its CORS header', () => {
    test.use({ netOptions: { itunesFetch: 'cors-blocked' } });
    test('fall back to JSONP', async ({ page, net }) => {
      await page.goto(APP_URL);
      await loadFiles(page, historyFile());
      await play(page, 'My listening history');
      expect(net.itunes.slice(0, 2).map(r => r.via)).toEqual(['fetch', 'jsonp']);
    });
  });

  test('use JSONP when the game is opened as a downloaded file', async ({ page, net }) => {
    await page.goto(FILE_URL);
    await loadFiles(page, historyFile());
    await play(page, 'My listening history');
    expect(net.itunes.length).toBeGreaterThan(0);
    expect(net.itunes.every(r => r.via === 'jsonp')).toBe(true);
  });

  test.describe('with no internet access', () => {
    test.use({ netOptions: { offline: true } });
    test('explain the problem instead of failing silently', async ({ page }) => {
      await page.goto(FILE_URL);
      await pasteSongs(page, 'Offline', PASTE);
      await expect(page.locator('#plMsg')).toContainText("Couldn't reach Spotify");
      await loadFiles(page, historyFile());
      await page.locator('.srcrow', { hasText: 'My listening history' }).getByRole('button', { name: 'Play', exact: true }).click();
      await expect(page.locator('#status')).toContainText("Couldn't reach the iTunes song search");
    });
  });
});

test.describe('analytics', () => {
  const events = page => page.evaluate(() => window.__umamiEvents || []);

  test('records imports, rounds and errors, and never song or artist names', async ({ page }) => {
    await page.goto(APP_URL);
    await loadFiles(page, await exportZip());
    await page.setInputFiles('#file', [csvFile()]);
    await pasteSongs(page, 'Pasted', PASTE);
    await play(page, 'My listening history');
    await giveUp(page);
    await page.click('#settingsBtn');
    await page.selectOption('#sourceSel', { label: 'Road Trip (shuffle)' });
    await expect(page.locator('#board')).toBeVisible();
    await guess(page, ROAD_TRIP[0]);
    const recorded = await events(page);
    expect(recorded.filter(e => e.name === 'import').map(e => e.data.source))
      .toEqual(['extended-history', 'export-playlists', 'csv', 'paste']);
    expect(recorded.find(e => e.name === 'round-end')).toEqual({ name: 'round-end', data: { mode: 'history', result: 'lost' } });
    // Nothing from anyone's music may leave the browser through analytics.
    const sent = JSON.stringify(recorded).toLowerCase();
    for (const [title, artist] of SONGS) {
      expect(sent).not.toContain(title.toLowerCase());
      expect(sent).not.toContain(artist.toLowerCase());
    }
    for (const word of [...ROAD_TRIP, 'TOTO', 'a-ha', 'Journey', 'Gym Mix', 'Pasted', 'Road Trip', 'September']) {
      expect(sent).not.toContain(word.toLowerCase());
    }
  });

  test.describe('when an ad blocker blocks it', () => {
    test.use({ netOptions: { analyticsBlocked: true } });
    test('the game still works', async ({ page }) => {
      await page.goto(APP_URL);
      await loadFiles(page, historyFile());
      await play(page, 'My listening history');
      await giveUp(page);
      await expect(page.locator('#outcome')).toHaveText('Out of guesses.');
    });
  });

  test.describe('with no internet access', () => {
    test.use({ netOptions: { offline: true } });
    test('records the error kind only', async ({ page }) => {
      await page.goto(APP_URL);
      await page.evaluate(() => { window.__umamiEvents = []; window.umami = { track: (name, data) => window.__umamiEvents.push({ name, data }) }; });
      await pasteSongs(page, 'Offline', PASTE);
      expect(await events(page)).toEqual([{ name: 'error', data: { kind: 'spotify-unreachable' } }]);
    });
  });
});

test.describe('layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('fits a phone screen without sideways scrolling', async ({ page }) => {
    await page.goto(APP_URL);
    await loadFiles(page, await exportZip());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await play(page, 'My listening history');
    await page.fill('#guess', 'dre');
    await expect(page.locator('#sugg li').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
