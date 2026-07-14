import fs from "fs";
import path from "path";
import { getDb } from "../db/connection";
import { getSettings } from "./settings";

type SongInfo = {
  id: string;
  name: string;
  artistName: string;
  albumName?: string;
  albumArtistName?: string;
  trackNumber?: number;
  discNumber?: number;
  duration: number | null;
  bitrate?: number;
  genres?: string[];
  releaseYear?: number;
  mbzRecordingId?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzAlbumId?: string;
};

export async function addToLibrary(audioPath: string, song: SongInfo): Promise<void> {
  const db = getDb();
  const settings = getSettings();
  const downloadFolder = settings.downloadFolder;
  if (!downloadFolder) return;

  if (!audioPath.startsWith(downloadFolder)) {
    console.warn("[library-writer] audio path outside download folder, skipping library insert");
    return;
  }

  const relPath = path.relative(downloadFolder, audioPath).replace(/\\/g, "/");
  const artistName = song.artistName || "Unknown";
  const albumName = song.albumName || `${song.name} (Single)`;
  const artistId = song.mbzArtistId ? `artist/${song.mbzArtistId}` : `artist/${artistName.replace(/[<>:"/\\|?*]/g, "_")}`;
  const albumId = song.mbzReleaseGroupId
    ? `${artistId}/album/${song.mbzReleaseGroupId}`
    : `${artistId}/album/${albumName.replace(/[<>:"/\\|?*]/g, "_")}`;
  const trackMid = song.mbzRecordingId || song.mbzAlbumId;
  const trackId = trackMid
    ? `${albumId}/music/${trackMid}`
    : `${albumId}/music/${generatePart("tr", relPath)}`;
  const now = Date.now();

  try {
    // Upsert artist (use mbzArtistId as primary key when available)
    db.prepare(
      `INSERT OR IGNORE INTO artists (id, name, sort_name, mbz_id, biography, genres, country, type, disambiguation, images, updated_at, enriched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      artistId, artistName, null,
      song.mbzArtistId || null, null,
      JSON.stringify(song.genres || []),
      null, null, null, "[]", now, null,
    );

    // Check if album exists
    const existingAlbum = db.prepare(
      "SELECT song_count, duration FROM albums WHERE id = ?",
    ).get(albumId) as { song_count: number; duration: number } | undefined;

    if (existingAlbum) {
      db.prepare(
        `UPDATE albums SET song_count = song_count + 1, duration = duration + ?, updated_at = ? WHERE id = ?`,
      ).run(song.duration || 0, now, albumId);
    } else {
      db.prepare(
        `INSERT INTO albums (id, artist_id, name, artist_name, album_artist, release_year, mbz_id, mbz_release_group_id, genres, images, song_count, duration, updated_at, enriched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        albumId, artistId, albumName, artistName,
        song.albumArtistName || artistName,
        song.releaseYear || null, song.mbzReleaseGroupId || null,
        song.mbzReleaseGroupId || null,
        JSON.stringify(song.genres || []), "[]", 1,
        song.duration || 0, now, null,
      );
    }

    // Upsert track
    db.prepare(
      `INSERT OR REPLACE INTO tracks (id, album_id, path, name, artist_name, album_name, track_number, disc_number, duration, bitrate, genre, mbz_recording_id, mbz_track_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      trackId, albumId, relPath, song.name, artistName,
      song.albumName || null,
      song.trackNumber || null, song.discNumber || null,
      song.duration || null, song.bitrate ?? null,
      (song.genres || []).join(", ") || null,
      song.mbzRecordingId || null, null,
    );

    console.log(`[library-writer] added "${song.name}" to library`);
  } catch (err) {
    console.warn("[library-writer] failed to add to library:", err);
  }
}

function generatePart(prefix: string, ...parts: string[]): string {
  let hash = 0;
  const str = parts.join("|");
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return `${prefix}_${Math.abs(hash).toString(36).substring(0, 12)}`;
}
