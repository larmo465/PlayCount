// Hermetic network for the game: every request the page makes is answered here.
//
// - The game itself is served from disk at a fake http origin (APP_URL), or opened as a file (FILE_URL).
// - iTunes search and Spotify oEmbed answers are replayed from tests/fixtures/. Run `npm run test:record`
//   to record any that are missing (needs real network access).
// - Preview audio is a generated WAV tone: Playwright's Chromium can't decode the real AAC previews.
// - JSZip comes from node_modules instead of cdnjs.
// - Any other request is aborted and fails the test, so a new dependency can't sneak in untested.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const INDEX = path.join(ROOT, 'index.html');
const RECORD = !!process.env.RECORD;

export const APP_URL = 'http://playcount.test/';
export const FILE_URL = 'file://' + INDEX;

function fixtureFile(kind, key) {
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 8);
  return path.join(FIXTURES, kind, `${slug}-${hash}.json`);
}

async function replay(kind, key, liveUrl, trim) {
  const file = fixtureFile(kind, key);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (!RECORD) throw new Error(`No recorded ${kind} response for "${key}". Run "npm run test:record" to record it.`);
  const res = await fetch(liveUrl);
  const body = res.ok ? trim(await res.json()) : null;
  const saved = { status: res.status, body };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(saved, null, 1) + '\n');
  return saved;
}

// Only keep the fields the game reads, so fixtures stay small and readable.
const trimItunes = d => ({
  resultCount: d.resultCount,
  results: (d.results || []).map(r => ({
    trackName: r.trackName, artistName: r.artistName, collectionName: r.collectionName,
    previewUrl: r.previewUrl, artworkUrl100: r.artworkUrl100
  }))
});
const trimOembed = d => ({ title: d.title, thumbnail_url: d.thumbnail_url });

let wav;
function toneWav(seconds = 30, rate = 8000) {
  if (wav) return wav;
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000), 44 + i * 2);
  return (wav = buf);
}

/**
 * Route all of the page's network traffic.
 * @param {'ok'|'cors-blocked'} itunesFetch  'cors-blocked' makes fetch() to iTunes fail like it does in
 *   real browsers when iTunes leaves out its CORS header; JSONP requests still work.
 * @param {boolean} offline  every external request fails to connect.
 */
export async function mockNetwork(page, { itunesFetch = 'ok', offline = false } = {}) {
  const log = { itunes: [], oembed: [], unexpected: [] };
  await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.host === 'playcount.test') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(INDEX) });
    }
    if (offline) return route.abort('internetdisconnected');

    if (url.host === 'itunes.apple.com' && url.pathname === '/search') {
      const callback = url.searchParams.get('callback');
      const term = url.searchParams.get('term');
      log.itunes.push({ term, via: callback ? 'jsonp' : 'fetch' });
      if (!callback && itunesFetch === 'cors-blocked') return route.abort('failed');
      const live = new URL(url); live.searchParams.delete('callback');
      const { status, body } = await replay('itunes', `${url.searchParams.get('country')}|${term}`, live.href, trimItunes);
      if (callback) return route.fulfill({ status, contentType: 'text/javascript', body: `${callback}(${JSON.stringify(body)});` });
      return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    }
    if (url.host === 'open.spotify.com' && url.pathname === '/oembed') {
      const id = (url.searchParams.get('url') || '').split('/').pop();
      log.oembed.push(id);
      const { status, body } = await replay('oembed', id, url.href, trimOembed);
      return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    }
    if (url.host.startsWith('audio-ssl.') || url.pathname.endsWith('.m4a')) {
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: toneWav() });
    }
    if (/mzstatic\.com$|spotifycdn\.com$|scdn\.co$/.test(url.host)) {
      return route.fulfill({ status: 404, body: '' });   // artwork isn't needed
    }
    if (url.host === 'cdnjs.cloudflare.com' && url.pathname.includes('/jszip/')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(ROOT, 'node_modules/jszip/dist/jszip.min.js')) });
    }
    log.unexpected.push(req.url());
    return route.abort('blockedbyclient');
  });
  return log;
}
