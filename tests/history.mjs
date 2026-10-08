import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const SP = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args:['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => m.type()==='error' && errors.push('console: '+m.text()));
const lookups = [];
await page.route(/^https:\/\//, async route => {
  const url = route.request().url();
  if (url.includes('itunes.apple.com/search')) lookups.push(decodeURIComponent(url.split('term=')[1]));
  if (/\.m4a|audio-ssl|mzaf_/.test(url)) { await route.fulfill({ status: 200, contentType: 'audio/wav', body: (await import('fs')).readFileSync(SP + '/tests/tone.wav') }); return; }
  const r = await fetch(url);
  const body = Buffer.from(await r.arrayBuffer());
  const headers = Object.fromEntries(r.headers); delete headers['content-encoding']; delete headers['content-length'];
  await route.fulfill({ status: r.status, headers, body });
});
await page.addInitScript(() => {
  window.__ev = [];
  const P = HTMLMediaElement.prototype;
  const pause = P.pause;
  P.pause = function () { if (!this.paused) window.__ev.push(['pause', performance.now(), this.currentTime]); return pause.call(this); };
  const play = P.play;
  P.play = function () { const el = this; return play.call(this).then(r => { window.__ev.push(['playing', performance.now(), el.currentTime]); return r; }); };
});
await page.goto('file://' + SP + '/index.html');
await page.setInputFiles('#file', SP + '/tests/Streaming_History_Audio_2024_0.json');
await page.waitForSelector('.srcrow button.primary'); await page.click('.srcrow button.primary');
await page.waitForSelector('#board:not(.hidden)', { timeout: 30000 });
console.log('loadMsg:', await page.textContent('#loadMsg'));
await page.waitForFunction(() => !document.getElementById('playBtn').disabled, null, { timeout: 30000 });
// play the 0.5s clip and measure
await page.click('#playBtn');
await page.waitForFunction(() => window.__ev.some(e => e[0] === 'pause'), null, { timeout: 5000 });
const ev = await page.evaluate(() => window.__ev);
console.log('events:', JSON.stringify(ev));
const pl = ev.find(e => e[0] === 'playing'), pa = ev.find(e => e[0] === 'pause');
console.log('0.5s clip: audible for', Math.round(pa[1] - pl[1]), 'ms, stopped at media time', pa[2].toFixed(3), 's');
// wrong guess, skip, then correct guess via the answer
const lib = await page.evaluate(() => JSON.parse(localStorage.getItem('pc.lib.v1')));
console.log('library:', lib.map(x => `${x[0]} (${x[2]})`).join(' | '));
await page.fill('#guess', 'hey ya');
await page.waitForSelector('#sugg li');
console.log('suggestions for "hey ya":', await page.$$eval('#sugg li', l => l.map(x => x.textContent)));
await page.keyboard.press('Enter');
await page.click('#skipBtn');
console.log('slots:', await page.$$eval('.slot', l => l.map(x => x.className + ':' + x.textContent).slice(0,3)));
console.log('skip label now:', await page.textContent('#skipBtn'));
// cheat: find the answer and guess it
const answer = await page.evaluate(() => document.getElementById('art') && null);
for (let i = 0; i < 4; i++) await page.click('#skipBtn');
await page.waitForSelector('#resultPanel:not(.hidden)');
console.log('outcome:', await page.textContent('#outcome'), '|', await page.textContent('#revTitle'), '|', await page.textContent('#revPlays'));
console.log('art:', await page.getAttribute('#art','src'));
// play several rounds to check distribution & that the nonexistent song is dropped
const seen = {};
for (let i = 0; i < 6; i++) {
  await page.click('#nextBtn');
  await page.waitForSelector('#board:not(.hidden)', { timeout: 30000 });
  for (let j = 0; j < 6; j++) await page.click('#skipBtn');
  const t = await page.textContent('#revTitle'); seen[t] = (seen[t]||0)+1;
}
console.log('next rounds:', seen);
const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('pc.cache.v1')));
console.log('cache:', Object.entries(cache).map(([k,v]) => k + ' -> ' + (v ? 'preview' : 'none')));
await page.setViewportSize({ width: 390, height: 844 });
await page.click('#nextBtn'); await page.waitForSelector('#board:not(.hidden)');
await page.click('#skipBtn'); await page.fill('#guess','dre'); await page.waitForSelector('#sugg li');
await page.screenshot({ path: SP + '/tests/mobile.png', fullPage: true });
console.log('hscroll:', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
console.log('lookups:', lookups.length, 'errors:', errors);
await browser.close();
