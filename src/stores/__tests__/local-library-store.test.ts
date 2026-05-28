import { describe, it, expect } from "vitest";
import { isAudioFile, fileIdFromPath, guessMetadataFromPath } from "../local-library.store";

describe("isAudioFile", () => {
  it("returns true for common audio extensions", () => {
    expect(isAudioFile("song.mp3")).toBe(true);
    expect(isAudioFile("track.flac")).toBe(true);
    expect(isAudioFile("audio.ogg")).toBe(true);
    expect(isAudioFile("sound.wav")).toBe(true);
    expect(isAudioFile("file.m4a")).toBe(true);
    expect(isAudioFile("music.aac")).toBe(true);
    expect(isAudioFile("song.wma")).toBe(true);
    expect(isAudioFile("track.opus")).toBe(true);
    expect(isAudioFile("audio.aiff")).toBe(true);
    expect(isAudioFile("sound.alac")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isAudioFile("Song.MP3")).toBe(true);
    expect(isAudioFile("Track.FLAC")).toBe(true);
    expect(isAudioFile("Audio.Ogg")).toBe(true);
  });

  it("returns false for non-audio files", () => {
    expect(isAudioFile("document.pdf")).toBe(false);
    expect(isAudioFile("image.jpg")).toBe(false);
    expect(isAudioFile("video.mp4")).toBe(false);
    expect(isAudioFile("script.js")).toBe(false);
    expect(isAudioFile("")).toBe(false);
  });

  it("returns false for files with no extension", () => {
    expect(isAudioFile("README")).toBe(false);
    expect(isAudioFile("Makefile")).toBe(false);
  });

  it("handles files with multiple dots", () => {
    expect(isAudioFile("my.song.mp3")).toBe(true);
    expect(isAudioFile("my.file.txt")).toBe(false);
  });
});

describe("fileIdFromPath", () => {
  it("produces consistent IDs for same path", () => {
    const path = "/home/user/Music/song.mp3";
    expect(fileIdFromPath(path)).toBe(fileIdFromPath(path));
  });

  it("produces different IDs for different paths", () => {
    const id1 = fileIdFromPath("/music/a.mp3");
    const id2 = fileIdFromPath("/music/b.mp3");
    expect(id1).not.toBe(id2);
  });

  it("produces different IDs for same filename in different dirs", () => {
    const id1 = fileIdFromPath("/dir1/song.mp3");
    const id2 = fileIdFromPath("/dir2/song.mp3");
    expect(id1).not.toBe(id2);
  });

  it("starts with local_", () => {
    expect(fileIdFromPath("/any/path/file.mp3")).toMatch(/^local_/);
  });

  it("handles paths with special characters", () => {
    const id = fileIdFromPath("/music/artista - música (2024)/canção.mp3");
    expect(id).toMatch(/^local_/);
    expect(id.length).toBeGreaterThan(6);
  });
});

describe("guessMetadataFromPath", () => {
  it("parses Artist/Album/Song structure", () => {
    const result = guessMetadataFromPath("Artist Name/Album Name/Song Title.mp3");
    expect(result).toEqual({
      artistName: "Artist Name",
      albumName: "Album Name",
      name: "Song Title",
    });
  });

  it("parses Album/Song when no artist", () => {
    const result = guessMetadataFromPath("Artist Name/Song Title.mp3");
    expect(result).toEqual({
      artistName: "Unknown Artist",
      albumName: "Artist Name",
      name: "Song Title",
    });
  });

  it("parses flat path with no artist/album", () => {
    const result = guessMetadataFromPath("Song Title.mp3");
    expect(result).toEqual({
      artistName: "Unknown Artist",
      albumName: null,
      name: "Song Title",
    });
  });

  it("removes file extension", () => {
    const result = guessMetadataFromPath("Artist/Album/Track Name.flac");
    expect(result.name).toBe("Track Name");
  });

  it("handles paths with leading dot segment", () => {
    const result = guessMetadataFromPath("./Music/Artist/Album/Song.mp3");
    expect(result.artistName).toBe(".");
    expect(result.albumName).toBe("Music");
    expect(result.name).toBe("Song");
  });

  it("handles Windows backslash paths", () => {
    const result = guessMetadataFromPath("Artist\\Album\\Song.mp3");
    expect(result.artistName).toBe("Artist");
    expect(result.albumName).toBe("Album");
    expect(result.name).toBe("Song");
  });

  it("handles deep nested paths", () => {
    const result = guessMetadataFromPath("Root/Genre/Artist/Album/Song.mp3");
    expect(result.artistName).toBe("Root");
    expect(result.albumName).toBe("Genre");
    expect(result.name).toBe("Song");
  });

  it("handles empty relative path", () => {
    const result = guessMetadataFromPath("file.mp3");
    expect(result.artistName).toBe("Unknown Artist");
    expect(result.albumName).toBeNull();
    expect(result.name).toBe("file");
  });
});
