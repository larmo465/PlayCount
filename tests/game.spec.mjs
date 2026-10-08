import { test as base, expect } from '@playwright/test';
import { mockNetwork, scenarioTrack, APP_URL, FILE_URL } from './support/network.mjs';
import { SONGS, TOTAL_PLAYS, ROAD_TRIP, historyFile, basicHistoryFile, exportZip, csvFile, PASTE } from './support/data.mjs';

// Every test gets the mocked network, a seeded Math.random (so song picks, and therefore the
// recorded lookups they need, are the same on every run), and fails on page errors or unmocked requests.
const test = base.extend({
  netOptions: [{}, { option: true }],
  randomSeq: [[], { option: true }],     // values Math.random returns first, before the seeded sequence
  analyticsOptOut: [true, { option: true }],
  net: [async ({ page, netOptions, randomSeq, analyticsOptOut }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    // Internal traffic is always opted out of analytics (the Umami script is also stubbed, and the real
    // collection endpoint isn't mocked, so any request to it would fail the test).
    if (analyticsOptOut) await page.addInitScript(() => { try { localStorage.setItem('umami.disabled', '1'); } catch {} });
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

test.describe('analytics opt-out for testers', () => {
  test.use({ analyticsOptOut: false });   // test the switch itself, starting from a counted browser
  test('?notrack turns counting off for this browser and ?track turns it back on', async ({ page }) => {
    await page.goto(APP_URL);
    expect(await page.evaluate(() => localStorage.getItem('umami.disabled'))).toBeNull();
    await page.goto(APP_URL + '?notrack');
    expect(await page.evaluate(() => localStorage.getItem('umami.disabled'))).toBe('1');
    await page.goto(APP_URL);   // remembered without the parameter
    expect(await page.evaluate(() => localStorage.getItem('umami.disabled'))).toBe('1');
    await page.goto(APP_URL + '?track');
    expect(await page.evaluate(() => localStorage.getItem('umami.disabled'))).toBeNull();
  });
});

// Pasted Spotify links only give a title and a cover. These made-up scenarios check how the game picks
// the right song when other songs share the title.
test.describe('matching Spotify links', () => {
  const id = n => String(n).padStart(22, 'x');            // a valid-looking Spotify track ID
  const link = n => 'https://open.spotify.com/track/' + id(n);
  async function resolve(page, links) {
    await page.addInitScript(() => { window.__PC_BG_INTERVAL__ = 20; });
    await page.goto(APP_URL);
    await pasteSongs(page, 'Links', links.join('\n'));
    await play(page, 'Links');
  }
  const matched = (page, n) => page.evaluate(k => {
    const info = JSON.parse(localStorage.getItem('pc.cache.v1') || '{}')[k];
    return info === undefined ? undefined : info && `${info.title} — ${info.artist}`;
  }, 'sp:' + id(n));

  test.describe('several songs share the title', () => {
    test.use({ netOptions: { scenario: {
      links: { [id(1)]: { title: 'Overtime', cover: 1 } },
      songs: [scenarioTrack('Overtime', 'Popular Act', 2), scenarioTrack('Overtime', 'Other Band', 3), scenarioTrack('Overtime', 'Right Artist', 1)],
    } } });
    test('picks the one with the same album cover', async ({ page }) => {
      await resolve(page, [link(1)]);
      await expect.poll(() => matched(page, 1)).toBe('Overtime — Right Artist');
    });
  });

  test.describe("the title search doesn't include the right song", () => {
    // Like a common title with 50+ songs: "Overtime" by Right Artist only turns up in an artist search.
    // It resolves first, before the playlist's artist is known, so this also covers the second try.
    test.use({ netOptions: { scenario: {
      links: { [id(1)]: { title: 'Overtime', cover: 11 }, [id(2)]: { title: 'River Song', cover: 12 }, [id(3)]: { title: 'Night Drive', cover: 13 } },
      songs: [scenarioTrack('Overtime', 'Popular Act', 2), scenarioTrack('Overtime', 'Right Artist', 11),
        scenarioTrack('River Song', 'Right Artist', 12), scenarioTrack('Night Drive', 'Right Artist', 13)],
      titleSearch: term => [scenarioTrack('Overtime', 'Popular Act', 2), scenarioTrack('River Song', 'Right Artist', 12), scenarioTrack('Night Drive', 'Right Artist', 13)]
        .filter(t => term.startsWith(t.trackName)),
    } } });
    test("finds it in the songs of the playlist's main artist", async ({ page, net }) => {
      await resolve(page, [link(1), link(2), link(3)]);
      await expect.poll(() => matched(page, 1), { timeout: 15000 }).toBe('Overtime — Right Artist');
      expect(net.itunes.filter(r => r.byArtist).map(r => r.term)).toContain('Right Artist');
      await expect.poll(() => matched(page, 2)).toBe('River Song — Right Artist');
      await expect.poll(() => matched(page, 3)).toBe('Night Drive — Right Artist');
      await page.fill('#guess', 'right artist');
      await expect(page.locator('#sugg li')).toHaveText(['Night Drive — Right Artist', 'Overtime — Right Artist', 'River Song — Right Artist']);
    });
  });

  test.describe('no song with the same cover exists', () => {
    // "Tourniquet" by Right Artist isn't on iTunes; only other artists' songs with that title are.
    // "Lantern" is, but with different artwork than on Spotify (say, a single vs the album).
    test.use({ netOptions: { scenario: {
      links: { [id(1)]: { title: 'River Song', cover: 31 }, [id(2)]: { title: 'Tourniquet', cover: 32 }, [id(3)]: { title: 'Lantern', cover: 33 } },
      songs: [scenarioTrack('River Song', 'Right Artist', 31), scenarioTrack('Tourniquet', 'Stranger Band', 34),
        scenarioTrack('Lantern', 'Right Artist', 35)],
    } } });
    test("skips a stranger's song rather than playing the wrong one, but trusts an artist from the playlist", async ({ page }) => {
      await resolve(page, [link(1), link(2), link(3)]);
      await expect.poll(() => matched(page, 1)).toBe('River Song — Right Artist');
      await expect.poll(() => matched(page, 2), { timeout: 15000 }).toBeNull();
      await expect.poll(() => matched(page, 3), { timeout: 15000 }).toBe('Lantern — Right Artist');
      await page.click('#settingsBtn');
      await expect(page.locator('#poolInfo')).toHaveText('2 of 3 songs playable.');
    });
  });

  test.describe('the title names a featured artist', () => {
    test.use({ netOptions: { scenario: {
      links: { [id(1)]: { title: 'Better Days (feat. Guest Star)', cover: null } },
      songs: [scenarioTrack('Better Days', 'Popular Act', 2), scenarioTrack('Better Days (feat. Guest Star)', 'Main Act & Guest Star', 4)],
    } } });
    test('searches with it and picks that version', async ({ page, net }) => {
      await resolve(page, [link(1)]);
      await expect.poll(() => matched(page, 1)).toBe('Better Days (feat. Guest Star) — Main Act & Guest Star');
      expect(net.itunes[0].term).toBe('Better Days Guest Star');   // featured artist added to the search
    });
  });

  test.describe('the title has a part after a dash', () => {
    test.use({ netOptions: { scenario: {
      links: { [id(1)]: { title: 'Codeine Pills - Part One', cover: 5 }, [id(2)]: { title: 'Old Song - Remastered 2011', cover: 6 } },
      songs: [scenarioTrack('Codeine Pills - Part One', 'Right Artist', 5), scenarioTrack('Old Song', 'Classic Band', 6)],
    } } });
    test('keeps real title parts in the search but drops version labels', async ({ page, net }) => {
      await resolve(page, [link(1), link(2)]);
      await expect.poll(() => matched(page, 1)).toBe('Codeine Pills - Part One — Right Artist');
      await expect.poll(() => matched(page, 2)).toBe('Old Song — Classic Band');
      expect(net.itunes.map(r => r.term)).toEqual(expect.arrayContaining(['Codeine Pills - Part One', 'Old Song']));
    });
  });
});

// Playlists imported before the better link matching are stored without the original Spotify title and
// cover, and may hold wrong matches. The game offers to reprocess them.
test.describe('reprocessing a playlist imported before the better matching', () => {
  const id = n => String(n).padStart(22, 'y');
  test.use({ netOptions: { scenario: {
    links: { [id(1)]: { title: 'Overtime', cover: 1 }, [id(2)]: { title: 'River Song', cover: 2 } },
    songs: [scenarioTrack('Overtime', 'Popular Act', 9), scenarioTrack('Overtime', 'Right Artist', 1), scenarioTrack('River Song', 'Right Artist', 2)],
  } } });
  // The old saved format: [title, artist, uri, query, titleOnly, key], with "Overtime" matched to the wrong artist.
  async function seedOldPlaylist(page) {
    await page.addInitScript(([a, b]) => {
      if (localStorage.getItem('test.seeded')) return;
      localStorage.setItem('test.seeded', '1');
      localStorage.setItem('pc.playlists.v1', JSON.stringify([{ id: 'pl:old', name: 'Old Mix', tracks: [
        ['Overtime', 'Popular Act', 'spotify:track:' + a, 'Overtime', 1, 'sp:' + a],
        ['River Song', 'Right Artist', 'spotify:track:' + b, 'River Song', 1, 'sp:' + b],
      ] }]));
      const hit = (t, ar) => ({ preview: `https://audio-ssl.itunes.apple.com/test/${encodeURIComponent(ar + ' ' + t)}.m4a`, art: '', title: t, artist: ar });
      localStorage.setItem('pc.cache.v1', JSON.stringify({ ['sp:' + a]: hit('Overtime', 'Popular Act'), ['sp:' + b]: hit('River Song', 'Right Artist') }));
      localStorage.setItem('pc.settings.v1', JSON.stringify({ source: 'pl:old', country: 'US' }));
    }, [id(1), id(2)]);
    await page.addInitScript(() => { window.__PC_BG_INTERVAL__ = 20; });
  }
  const matchedArtist = (page, n) => page.evaluate(k => (JSON.parse(localStorage.getItem('pc.cache.v1') || '{}')[k] || {}).artist, 'sp:' + id(n));

  test('offers it, and reprocessing fixes wrong matches', async ({ page }) => {
    await seedOldPlaylist(page);
    await page.goto(APP_URL);
    await expect(page.locator('#reprocessDlg')).toBeVisible();
    await expect(page.locator('#reprocessName')).toHaveText('Old Mix');
    await page.click('#reprocessGo');
    await expect(page.locator('#reprocessDlg')).toBeHidden({ timeout: 10000 });
    await expect.poll(() => matchedArtist(page, 1), { timeout: 15000 }).toBe('Right Artist');
    await expect.poll(() => matchedArtist(page, 2), { timeout: 15000 }).toBe('Right Artist');
    await page.reload();   // reprocessed playlists aren't offered again
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('#reprocessDlg')).toBeHidden();
    await page.click('#settingsBtn');
    await expect(page.locator('#reprocessRow')).toBeHidden();
  });

  test('"Not now" stops the pop-up, and Settings still offers it', async ({ page }) => {
    await seedOldPlaylist(page);
    await page.goto(APP_URL);
    await page.click('#reprocessLater');
    await page.reload();
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('#reprocessDlg')).toBeHidden();
    await page.click('#settingsBtn');
    await page.click('#reprocessFromSettings');
    await expect(page.locator('#reprocessDlg')).toBeVisible();
  });

  test("isn't offered for a playlist imported with the new matching", async ({ page }) => {
    await page.addInitScript(() => { window.__PC_BG_INTERVAL__ = 20; });
    await page.goto(APP_URL);
    await pasteSongs(page, 'New Mix', ['https://open.spotify.com/track/' + id(1), 'https://open.spotify.com/track/' + id(2)].join('\n'));
    await play(page, 'New Mix');
    await expect.poll(() => matchedArtist(page, 1), { timeout: 15000 }).toBe('Right Artist');
    await expect(page.locator('#reprocessDlg')).toBeHidden();
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
