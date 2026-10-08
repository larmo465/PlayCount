import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'fs';
const SP = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
await page.route(/^https:\/\//, async route => {
  const url = route.request().url();
  if (/\.m4a|audio-ssl|mzaf_/.test(url)) return route.fulfill({ status: 200, contentType: 'audio/wav', body: fs.readFileSync(SP + '/tests/tone.wav') });
  const r = await fetch(url);
  const headers = Object.fromEntries(r.headers); delete headers['content-encoding']; delete headers['content-length'];
  await route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
});
const finishRound = async () => { await page.waitForSelector('#board:not(.hidden)', { timeout: 30000 }); for (let j = 0; j < 6; j++) await page.click('#skipBtn'); return [await page.textContent('#revTitle'), await page.textContent('#revArtist'), await page.textContent('#revPlays')]; };

await page.goto('file://' + SP + '/index.html');
// 1. zip with history + playlists + liked songs
await page.setInputFiles('#file', SP + '/tests/my_spotify_data.zip');
await page.waitForSelector('#sources:not(.hidden)', { timeout: 30000 });
console.log('zip:', await page.textContent('#loadMsg'));
// 2. CSV
await page.setInputFiles('#file', SP + '/tests/Gym_Mix.csv');
await page.waitForFunction(() => document.querySelectorAll('.srcrow').length >= 4);
// 3. paste links + lines
await page.fill('#plName', 'Pasted');
await page.fill('#plText', 'https://open.spotify.com/track/003vvx7Niy0yvhvHt4a68B https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv?si=abc\nRadiohead - Creep\nSeptember - Earth, Wind & Fire\nhttps://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
await page.click('#plAdd');
await page.waitForFunction(() => /Added/.test(document.getElementById('plMsg').textContent), null, { timeout: 30000 });
console.log('paste:', await page.textContent('#plMsg'));
console.log('sources:', await page.$$eval('.srcrow', l => l.map(x => x.querySelector('.sn').textContent + ' [' + x.querySelector('.sd').textContent + ']')));

// Play the pasted playlist through a full shuffle cycle: every song exactly once.
const rows = await page.$$('.srcrow');
await rows[rows.length - 1].$('button.primary').then(b => b.click());
const seen = [];
for (let i = 0; i < 4; i++) { if (i) await page.click('#nextBtn'); seen.push((await finishRound()).join(' / ')); }
console.log('pasted shuffle cycle:\n  ' + seen.join('\n  '));
console.log('tag:', await page.textContent('#sourceTag'));

// Guess correctly in Road Trip via the autocomplete
await page.click('#settingsBtn');
const opts = await page.$$eval('#sourceSel option', o => o.map(x => [x.value, x.textContent]));
console.log('select:', opts.map(o => o[1]));
await page.selectOption('#sourceSel', opts.find(o => o[1].startsWith('Road Trip'))[0]);
await page.waitForSelector('#board:not(.hidden)', { timeout: 30000 });
const ans = await page.evaluate(() => null);
// try each Road Trip song until the right one is accepted
let won = false;
for (const q of ['africa', 'take on me', 'believin']) {
  if (await page.isVisible('#resultPanel')) break;
  await page.fill('#guess', q); await page.waitForSelector('#sugg li'); await page.keyboard.press('Enter');
}
console.log('road trip outcome:', await page.textContent('#outcome'), '|', await page.textContent('#revTitle'), '|', await page.textContent('#revPlays'));
console.log('slots:', await page.$$eval('.slot', l => l.map(x => x.className.replace('slot ', '') + ':' + x.textContent).filter(s => !s.startsWith('slot:'))));

// History mode still weighted
await page.click('#settingsBtn');
await page.selectOption('#sourceSel', 'history');
const r = await finishRound();
console.log('history round:', r.join(' | '));
// Reload persists playlists and goes straight into the game
await page.reload(); await page.waitForTimeout(8000); console.log('after reload status:', await page.textContent('#status'), await page.isVisible('#setup'), await page.isVisible('#game'));
await page.waitForSelector('#board:not(.hidden)', { timeout: 30000 });
await page.click('#settingsBtn');
console.log('after reload select:', await page.$$eval('#sourceSel option', o => o.map(x => x.textContent)));
await page.click('#importMore');
await page.setViewportSize({ width: 390, height: 900 });
await page.screenshot({ path: SP + '/tests/setup-mobile.png', fullPage: true });
console.log('hscroll:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'errors:', errors);
await browser.close();
