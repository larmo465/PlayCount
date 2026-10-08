// Synthetic Spotify exports for the tests.
import JSZip from 'jszip';

// [title, artist, plays]. "Zzz…" has no match on iTunes, so it must drop out of the pool.
export const SONGS = [
  ['Mr. Brightside', 'The Killers', 60],
  ['Bohemian Rhapsody - Remastered 2011', 'Queen', 25],
  ['Dreams - 2004 Remaster', 'Fleetwood Mac', 12],
  ['Get Lucky (feat. Pharrell Williams and Nile Rodgers)', 'Daft Punk', 6],
  ['Go Your Own Way - 2004 Remaster', 'Fleetwood Mac', 5],
  ['Zzz Nonexistent Track Qwerty', 'No Such Artist 123', 4],
  ['Hey Ya!', 'Outkast', 3],
];
export const TOTAL_PLAYS = SONGS.reduce((n, s) => n + s[2], 0);

// Extended streaming history: counted plays, plus skips under 30 s and a podcast that must be ignored.
export function extendedHistory() {
  const rows = [];
  SONGS.forEach(([title, artist, plays], i) => {
    for (let p = 0; p < plays; p++) {
      rows.push({ ts: '2024-01-01T00:00:00Z', ms_played: 200000, master_metadata_track_name: title,
        master_metadata_album_artist_name: artist, spotify_track_uri: `spotify:track:${String(i).padStart(22, 'x')}` });
    }
    rows.push({ ts: '2024-01-02T00:00:00Z', ms_played: 4000, master_metadata_track_name: title, master_metadata_album_artist_name: artist });
  });
  rows.push({ ts: '2024-01-03T00:00:00Z', ms_played: 900000, master_metadata_track_name: null, episode_name: 'A podcast' });
  return rows;
}
export const historyFile = () => ({
  name: 'Streaming_History_Audio_2024_0.json', mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(extendedHistory()))
});

// The one-year "Account data" export uses camelCase keys.
export const basicHistoryFile = () => ({
  name: 'StreamingHistory_music_0.json', mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify([
    { endTime: '2024-01-01 10:00', artistName: 'The Killers', trackName: 'Mr. Brightside', msPlayed: 220000 },
    { endTime: '2024-01-01 10:04', artistName: 'The Killers', trackName: 'Mr. Brightside', msPlayed: 220000 },
    { endTime: '2024-01-01 10:08', artistName: 'Queen', trackName: 'Bohemian Rhapsody', msPlayed: 10000 },
  ]))
});

export const ROAD_TRIP = ['Africa', "Take On Me", "Don't Stop Believin'"];

// The zip Spotify emails: history, playlists and Liked Songs in subfolders.
export async function exportZip() {
  const zip = new JSZip();
  zip.file('Spotify Extended Streaming History/Streaming_History_Audio_2024_0.json', JSON.stringify(extendedHistory()));
  zip.file('Spotify Account Data/Playlist1.json', JSON.stringify({ playlists: [{
    name: 'Road Trip', lastModifiedDate: '2024-01-01', items: [
      { track: { trackName: 'Africa', artistName: 'TOTO', albumName: 'Toto IV', trackUri: 'spotify:track:2374M0fQpWi3dLnB54qaLX' }, episode: null },
      { track: { trackName: 'Take On Me', artistName: 'a-ha', albumName: 'Hunting High and Low', trackUri: 'spotify:track:2WfaOiMkCvy7F5fcp2zZ8L' }, episode: null },
      { track: { trackName: "Don't Stop Believin'", artistName: 'Journey', albumName: 'Escape', trackUri: 'spotify:track:4bHsxqR3GMrXTxEPLuK5ue' } },
      { track: null, episode: { episodeName: 'A podcast episode' } },
    ] }] }));
  zip.file('Spotify Account Data/YourLibrary.json', JSON.stringify({ tracks: [
    { artist: 'Queen', album: 'Jazz', track: "Don't Stop Me Now - Remastered 2011", uri: 'spotify:track:7hQJA50XrCWABAu5v6QZ4i' },
    { artist: 'ABBA', album: 'Arrival', track: 'Dancing Queen', uri: 'spotify:track:0GjEhVFGZW8afUYGChu3Rr' },
  ] }));
  return { name: 'my_spotify_data.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) };
}

// Exportify-style CSV (with a byte-order mark, like the real thing).
export const csvFile = () => ({
  name: 'Gym_Mix.csv', mimeType: 'text/csv',
  buffer: Buffer.from('﻿"Track URI","Track Name","Album Name","Artist Name(s)","Release Date"\n' +
    '"spotify:track:1","Eye of the Tiger","Eye of the Tiger","Survivor","1982"\n' +
    '"spotify:track:2","Lose Yourself","8 Mile","Eminem","2002"\n' +
    '"spotify:track:3","Stronger","Graduation","Kanye West","2007"\n')
});

// What you get from select-all + copy in the Spotify desktop app, plus typed lines and a playlist link
// (which can't be read without a login and must be skipped).
export const PASTE = [
  'https://open.spotify.com/track/003vvx7Niy0yvhvHt4a68B',           // Mr. Brightside
  'https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv?si=abc123', // Bohemian Rhapsody
  'Earth, Wind & Fire - September',
  'Fleetwood Mac - Dreams',
  'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
].join('\n');
