import { describe, it, expect } from "vitest";
import { dbSongToSong, dbRowToAlbum, dbRowToAlbumArtist, selftifyPlaylistToPlaylist } from "../dto";
import { OriginType } from "../../types/domain-types";

const TEST_ORIGIN_ID = "origin-1";

describe("DTO — dbSongToSong", () => {
  const dbSong = {
    id: "song-1",
    path: "/music/test.mp3",
    name: "Test Song",
    artist_name: "Test Artist",
    album_name: "Test Album",
    album_artist: "Test Artist",
    track_number: 3,
    disc_number: 1,
    duration: 240000,
    bitrate: 320,
    sample_rate: 44100,
    genre: "Rock",
    year: 2024,
    file_size: 10000000,
    file_extension: "mp3",
    last_modified: Date.now(),
    added_at: Date.now(),
    updated_at: Date.now(),
    mbz_recording_id: "mbz-rec-123",
    mbz_track_id: "mbz-track-456",
    mbz_album_id: "mbz-album-789",
    mbz_release_group_id: "mbz-rg-abc",
    mbz_artist_id: "mbz-artist-def",
  };

  it("should map all fields from DbSong to Song", () => {
    const song = dbSongToSong(dbSong, TEST_ORIGIN_ID);
    expect(song.id).toBe("song-1");
    expect(song.originId).toBe(TEST_ORIGIN_ID);
    expect(song.originType).toBe(OriginType.LOCAL);
    expect(song.name).toBe("Test Song");
    expect(song.artistName).toBe("Test Artist");
    expect(song.albumName).toBe("Test Album");
    expect(song.albumArtistName).toBe("Test Artist");
    expect(song.trackNumber).toBe(3);
    expect(song.discNumber).toBe(1);
    expect(song.duration).toBe(240000);
    expect(song.path).toBe("/music/test.mp3");
    expect(song.genres).toEqual(["Rock"]);
    expect(song.releaseYear).toBe(2024);
    expect(song.mbzRecordingId).toBe("mbz-rec-123");
    expect(song.mbzTrackId).toBe("mbz-track-456");
    expect(song.mbzArtistId).toBe("mbz-artist-def");
  });

  it("should set imageUrl to null by default", () => {
    const song = dbSongToSong(dbSong, TEST_ORIGIN_ID);
    expect(song.imageUrl).toBeNull();
  });

  it("should use imageUrlOverride when provided", () => {
    const song = dbSongToSong(dbSong, TEST_ORIGIN_ID, OriginType.LOCAL, "blob:test-url");
    expect(song.imageUrl).toBe("blob:test-url");
  });

  it("should handle null album_name gracefully", () => {
    const song = dbSongToSong({ ...dbSong, album_name: null }, TEST_ORIGIN_ID);
    expect(song.albumName).toBeUndefined();
  });

  it("should use 'Unknown Artist' when artist_name is empty", () => {
    const song = dbSongToSong({ ...dbSong, artist_name: "" }, TEST_ORIGIN_ID);
    expect(song.artistName).toBe("Unknown Artist");
  });

  it("should set genres as empty array when genre is null", () => {
    const song = dbSongToSong({ ...dbSong, genre: null }, TEST_ORIGIN_ID);
    expect(song.genres).toEqual([]);
  });
});

describe("DTO — dbRowToAlbum", () => {
  const row = {
    name: "Test Album",
    artist_name: "Test Artist",
    song_count: 12,
    duration: 3600000,
  };

  it("should map all fields to Album", () => {
    const album = dbRowToAlbum(row, TEST_ORIGIN_ID, "blob:cover-url");
    expect(album.name).toBe("Test Album");
    expect(album.albumArtistName).toBe("Test Artist");
    expect(album.songCount).toBe(12);
    expect(album.duration).toBe(3600000);
    expect(album.imageUrl).toBe("blob:cover-url");
    expect(album.originId).toBe(TEST_ORIGIN_ID);
    expect(album.originType).toBe(OriginType.LOCAL);
  });

  it("should generate a deterministic id", () => {
    const album1 = dbRowToAlbum(row, TEST_ORIGIN_ID, null);
    const album2 = dbRowToAlbum(row, TEST_ORIGIN_ID, null);
    expect(album1.id).toBe(album2.id);
    expect(album1.id).toContain("local-album-");
  });
});

describe("DTO — dbRowToAlbumArtist", () => {
  const row = {
    name: "Test Artist",
    song_count: 24,
    album_count: 3,
  };

  it("should map all fields to AlbumArtist", () => {
    const artist = dbRowToAlbumArtist(row, TEST_ORIGIN_ID, "blob:artist-url");
    expect(artist.name).toBe("Test Artist");
    expect(artist.songCount).toBe(24);
    expect(artist.albumCount).toBe(3);
    expect(artist.imageUrl).toBe("blob:artist-url");
    expect(artist.originId).toBe(TEST_ORIGIN_ID);
    expect(artist.originType).toBe(OriginType.LOCAL);
  });

  it("should generate a deterministic id", () => {
    const a1 = dbRowToAlbumArtist(row, TEST_ORIGIN_ID, null);
    const a2 = dbRowToAlbumArtist(row, TEST_ORIGIN_ID, null);
    expect(a1.id).toBe(a2.id);
    expect(a1.id).toContain("local-artist-");
  });
});

describe("DTO — selftifyPlaylistToPlaylist", () => {
  it("should map SelftifyPlaylist to Playlist domain type", () => {
    const pl = selftifyPlaylistToPlaylist({
      id: "/music/playlists/My Playlist.selftifylist",
      name: "My Playlist",
      originId: TEST_ORIGIN_ID,
      songCount: 5,
      createdAt: 1000,
      updatedAt: 2000,
    });
    expect(pl.id).toBe("/music/playlists/My Playlist.selftifylist");
    expect(pl.originId).toBe(TEST_ORIGIN_ID);
    expect(pl.name).toBe("My Playlist");
    expect(pl.songCount).toBe(5);
    expect(pl.imageUrl).toBeNull();
  });

  it("should set originType to LOCAL", () => {
    const pl = selftifyPlaylistToPlaylist({
      id: "/music/playlists/Test.selftifylist",
      name: "Test",
      originId: TEST_ORIGIN_ID,
      songCount: 0,
      createdAt: 1000,
      updatedAt: 2000,
    });
    expect(pl.originType).toBe(OriginType.LOCAL);
  });
});
