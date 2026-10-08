# PlayCount

Personalized song guessing: a Songless-style game built from your own Spotify music.

**Play it: <https://larmo465.github.io/PlayCount/>**

You hear the first half-second of a song. Every wrong guess or skip unlocks more
(0.5 → 1 → 2 → 4 → 8 → 16 s). You get six tries.

## Two ways to play

- **Listening history.** Drop in your Spotify privacy-export zip. Each song's chance
  of coming up is proportional to how often you've played it. A slider in Settings
  goes from "every song equally likely" to "strongly favour your top songs", and you
  can set a minimum play count.
- **Playlists, shuffled.** Every song plays once in random order, then it reshuffles.
  Import a playlist from:
  - the `Playlist*.json` / `YourLibrary.json` (Liked Songs) files in the same export,
  - a CSV from [Exportify](https://exportify.net),
  - pasted Spotify track links (in the desktop app, select all tracks in a playlist
    and copy) or `Artist - Title` lines.

## Running it

It's one static file. Open `index.html` in Chrome, Edge, Safari or Firefox, or
serve the folder from any static host (GitHub Pages works).

## Getting your Spotify data

Spotify's Web API doesn't expose play counts; the privacy export does.

1. Go to <https://www.spotify.com/account/privacy/>.
2. Request **Extended streaming history** for your whole history (up to 30 days), or
   **Account data** for the last year (about 5 days). Account data also has your
   playlists and Liked Songs, so tick both if you want those too.
3. Drop the zip from the email into the game.

A play counts when you listened for 30 seconds or more, matching Spotify's own rule
(you can turn this off).

## How it works

- Your data stays in your browser (`localStorage`). Nothing is uploaded.
- Audio is the 30-second preview from the public iTunes Search API (no key needed).
  Songs iTunes can't find drop out of the pool. The matcher prefers the original
  recording over live, acoustic, remix, cover and karaoke versions.
- Pasted Spotify track links are resolved with Spotify's public oEmbed endpoint,
  which gives the title and album cover but not the artist. To find the right song
  among same-titled ones, the game:
  - compares album covers (a small image hash): a matching cover is a sure match;
  - uses featured artists named in the title ("feat. …") in the search;
  - looks in the song lists of the artists the playlist has most, when the title
    search doesn't include the right song;
  - gives unconfirmed songs a second try once the whole playlist has been looked at.

  A song without a matching cover is only used if it's by an artist you already have
  (in the playlist or your history) or one named in the title. Otherwise the song is
  skipped instead of playing a same-titled song by someone else. This runs in the
  background while you play (about 15 songs a minute), and the results are saved. Playlist and album *links* can't be read without a Spotify login, which
  is why you paste the tracks instead.
- iTunes allows about 20 lookups a minute. Results are cached, so this only matters
  on a fresh library.

## Tests

Playwright tests drive the game in a real browser. The network is mocked
(`tests/support/network.mjs`): iTunes and Spotify answers are replayed from
`tests/fixtures/`, previews are a generated tone (Playwright's Chromium can't decode
AAC), and any request the tests don't expect fails the test. Song picks use a seeded
random sequence, so runs are repeatable.

```sh
npm ci
npx playwright install chromium
npm test               # the full suite, offline, in about 10 seconds
npm run test:record    # record API answers that are missing (needs internet)
npm run smoke          # check the live site (real network, Google Chrome)
```

If a change makes the game look up a song that has no recording yet, the test fails
with "No recorded … response". Run `npm run test:record` and commit the new files in
`tests/fixtures/`.

## Analytics and testing

The live site sends anonymous, cookie-free usage stats to Umami. Internal traffic is kept out:

- **Playtesters and you:** open the game once with
  <https://larmo465.github.io/PlayCount/?notrack>. That browser is no longer counted, even on
  later visits without `?notrack`. Use `?track` to be counted again. Do it once per browser and
  device.
- **Automated tests** never reach Umami: the script is stubbed, the game runs on a fake address that
  Umami ignores (`data-domains`), and every test also sets the opt-out.
- **The post-deploy smoke test** opens the live site with `?notrack` and fails if anything is sent to
  Umami.

## CI/CD

`.github/workflows/ci-cd.yml`:

| When | What runs |
|---|---|
| Pull request | Tests |
| Push to `main` | Tests → deploy to GitHub Pages → smoke test of the live site |
| Mondays | Smoke test of the live site, to catch iTunes/Spotify API changes |

The live site is only published by the deploy job, and only after the tests pass on
that commit. The deployed page carries the commit ID in `<meta name="build">`, and the
smoke test checks that the live site is serving it.

One-time setup in the repo settings:

1. **Settings → Pages → Source: GitHub Actions** (instead of "Deploy from a branch").
2. Optional, recommended: **Settings → Rules → Rulesets**, a rule for `main` that
   requires a pull request and the **test** status check, so nothing reaches `main`
   untested.
