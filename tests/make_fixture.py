import json, random
songs = [("Mr. Brightside","The Killers",60),("Bohemian Rhapsody - Remastered 2011","Queen",25),("Dreams - 2004 Remaster","Fleetwood Mac",12),("Get Lucky (feat. Pharrell Williams and Nile Rodgers)","Daft Punk",6),("Hey Ya!","Outkast",3),("Zzz Nonexistent Track Qwerty","No Such Artist 123",4)]
recs=[]
for t,a,n in songs:
    for i in range(n): recs.append({"ts":"2024-01-01T00:00:00Z","ms_played":200000,"master_metadata_track_name":t,"master_metadata_album_artist_name":a,"spotify_track_uri":"spotify:track:abc%d"%len(recs),"episode_name":None})
    recs.append({"ts":"2024-01-01T00:00:00Z","ms_played":5000,"master_metadata_track_name":t,"master_metadata_album_artist_name":a,"spotify_track_uri":None})
recs.append({"ts":"x","ms_played":900000,"master_metadata_track_name":None,"master_metadata_album_artist_name":None,"episode_name":"Some podcast"})
random.shuffle(recs)
json.dump(recs,open("Streaming_History_Audio_2024_0.json","w"))

# Playlist fixtures: an export zip (history + Playlist1.json + YourLibrary.json) and an Exportify-style CSV.
import zipfile
pl = {"playlists": [{"name": "Road Trip", "lastModifiedDate": "2024-01-01", "items": [
    {"track": {"trackName": "Africa", "artistName": "TOTO", "albumName": "Toto IV", "trackUri": "spotify:track:2374M0fQpWi3dLnB54qaLX"}, "episode": None, "localTrack": None},
    {"track": {"trackName": "Take On Me", "artistName": "a-ha", "albumName": "x", "trackUri": "spotify:track:2WfaOiMkCvy7F5fcp2zZ8L"}, "episode": None},
    {"track": {"trackName": "Don't Stop Believin'", "artistName": "Journey", "albumName": "x", "trackUri": "spotify:track:4bHsxqR3GMrXTxEPLuK5ue"}},
    {"track": None, "episode": {"episodeName": "pod"}}]}]}
lib = {"tracks": [{"artist": "Queen", "album": "x", "track": "Don't Stop Me Now - Remastered 2011", "uri": "spotify:track:7hQJA50XrCWABAu5v6QZ4i"},
                  {"artist": "ABBA", "album": "x", "track": "Dancing Queen", "uri": "spotify:track:0GjEhVFGZW8afUYGChu3Rr"}]}
with zipfile.ZipFile("my_spotify_data.zip", "w") as z:
    z.write("Streaming_History_Audio_2024_0.json", "Spotify Extended Streaming History/Streaming_History_Audio_2024_0.json")
    z.writestr("Spotify Account Data/Playlist1.json", json.dumps(pl))
    z.writestr("Spotify Account Data/YourLibrary.json", json.dumps(lib))
open("Gym_Mix.csv", "w").write('﻿"Track URI","Track Name","Album Name","Artist Name(s)","Release Date"\n'
    '"spotify:track:1","Eye of the Tiger","x","Survivor","1982"\n'
    '"spotify:track:2","Lose Yourself","x","Eminem","2002"\n'
    '"spotify:track:3","Stronger","Graduation","Kanye West","2007"\n')
