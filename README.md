# Playcount

A Songless-style "guess the song" game built from your own Spotify music.

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
- Pasted Spotify track links are resolved to titles with Spotify's public oEmbed
  endpoint, which doesn't give the artist. The game looks the artists up on iTunes in
  the background while you play (about 15 songs a minute) and saves them, so you can
  search the guess box by artist. Playlist and album *links* can't be read without a Spotify login, which
  is why you paste the tracks instead.
- iTunes allows about 20 lookups a minute. Results are cached, so this only matters
  on a fresh library.

## Tests

Headless browser tests (Playwright + Chromium) drive both modes end to end.
Playwright's Chromium build can't decode AAC, so the tests serve a generated WAV
in place of the iTunes previews.

```sh
cd tests
python3 make_fixture.py                                   # synthetic history, export zip, playlist CSV
ffmpeg -f lavfi -i "sine=frequency=440:duration=30" tone.wav
node history.mjs "$(pwd)/.."                              # history mode
node playlists.mjs "$(pwd)/.."                            # playlist imports + shuffle
```
