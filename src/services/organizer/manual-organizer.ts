import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { OriginType } from "../../types/domain-types";
import { createFileOrganizer } from "./file-organizer";
import { sanitizeForPath } from "./sanitizer";
import { electronFs } from "../platform/electron-fs";
import { joinPaths, normalizePath } from "../../lib/path-utils";
import type { OrganizeResult } from "./file-organizer";

export type OrganizeAllResult = {
  organizedCount: number;
  failedCount: number;
  skippedCount: number;
  results: OrganizeResult[];
};

export async function organizeAllFiles(): Promise<OrganizeAllResult> {
  const addMsg = (text: string, level: "info" | "success" | "warn" | "danger" = "info") =>
    useStatusStore.getState().addMessage(text, level, "Library");

  const origin = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL);
  const libraryRoot = origin?.folderPath;
  if (!libraryRoot) {
    addMsg("No local library configured", "warn");
    return { organizedCount: 0, failedCount: 0, skippedCount: 0, results: [] };
  }

  const db = await import("../db/database");
  if (!db.isReady()) {
    try {
      await db.initDatabase(libraryRoot);
    } catch {
      addMsg("Library database not available", "warn");
      return { organizedCount: 0, failedCount: 0, skippedCount: 0, results: [] };
    }
  }

  const albumRepo = await import("../db/repositories/album-repo");
  const { getAllArtists } = await import("../db/repositories/artist-repo");
  const { sanitizeForPath: sanitize } = await import("./sanitizer");

  const albums = albumRepo.getAllAlbums();
  if (albums.length === 0) {
    addMsg("No files to organize — library is empty", "info");
    return { organizedCount: 0, failedCount: 0, skippedCount: 0, results: [] };
  }

  const organizer = createFileOrganizer(libraryRoot);
  const results: OrganizeResult[] = [];
  let organizedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  const totalTracks = albums.reduce((s, a) => s + a.meta.tracks.length, 0);
  let done = 0;

  addMsg(`Organizing ${totalTracks} files...`, "info");

  for (const { meta, artistDir } of albums) {
    for (const track of meta.tracks) {
      if (!track.path) {
        skippedCount++;
        continue;
      }

      const sourcePath = joinPaths(libraryRoot, track.path);
      const extension = track.path.includes(".") ? track.path.slice(track.path.lastIndexOf(".")) : ".mp3";

      try {
        const result = await organizer.organizeFile({
          libraryRoot,
          sourcePath,
          artistName: track.artistName || meta.artistName,
          albumName: track.albumName || meta.name,
          releaseYear: meta.releaseYear,
          trackNumber: track.trackNumber,
          discNumber: track.discNumber,
          trackTitle: track.name,
          extension,
        });

        results.push(result);

        if (result.skipped) {
          skippedCount++;
        } else if (result.targetPath) {
          organizedCount++;

          const newRelPath = joinPaths(result.targetAlbumRelDir, result.targetFileName);
          const newTrackId = joinPaths(artistDir, meta.name, newRelPath);
          const oldTrackId = joinPaths(artistDir, meta.name, track.path);

          db.exec("DELETE FROM tracks WHERE id = ?", [oldTrackId]);
          db.exec(
            `INSERT INTO tracks (id, album_id, path, name, artist_name, album_name, track_number, disc_number, duration, bitrate, genre, mbz_recording_id, mbz_track_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [newTrackId, joinPaths(artistDir, meta.name), newRelPath, track.name, track.artistName, track.albumName, track.trackNumber, track.discNumber, track.duration, track.bitrate ?? null, track.genre, track.mbzRecordingId, track.mbzTrackId],
          );
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }

      done++;
      if (done % 10 === 0) {
        addMsg(`Organizing... ${done}/${totalTracks}`, "info");
      }
    }
  }

  db.flushSave();

  if (organizedCount > 0) {
    addMsg(`Organized ${organizedCount} files`, "success");
  }
  if (failedCount > 0) {
    addMsg(`${failedCount} files failed to organize`, "warn");
  }
  if (skippedCount > 0) {
    addMsg(`${skippedCount} files already organized (skipped)`, "info");
  }

  // ── Regenerate NFO + cover.jpg for all albums ──

  addMsg("Updating metadata files...", "info");

  const artists = getAllArtists();
  const artistMap = new Map(artists.map((a) => [a.name.toLowerCase(), a]));

  for (const { meta } of albums) {
    try {
      const albumYear = meta.releaseYear;
      const albumDirBase = sanitize(meta.name);
      const albumDir = albumYear ? `${albumDirBase} (${albumYear})` : albumDirBase;
      const artistDir = sanitize(meta.artistName);
      const targetAlbumDir = joinPaths(libraryRoot, artistDir, albumDir);

      const artistEntry = artistMap.get(meta.artistName.toLowerCase());

      await electronFs.deleteFile(joinPaths(targetAlbumDir, "album.nfo")).catch(() => {});

      await organizer.writeAlbumArtifacts(targetAlbumDir, {
        libraryRoot,
        albumName: meta.name,
        artistName: meta.artistName,
        releaseYear: meta.releaseYear,
        genres: meta.genres,
        tracks: meta.tracks.map((t) => ({
          title: t.name,
          trackNumber: t.trackNumber,
          duration: t.duration,
          mbzRecordingId: t.mbzRecordingId,
          mbzTrackId: t.mbzTrackId,
          discNumber: t.discNumber,
          artistName: t.artistName,
        })),
        coverRelPath: meta.images?.[0]?.id || null,
        mbzId: meta.mbzId,
        mbzReleaseGroupId: meta.mbzReleaseGroupId,
        albumArtist: meta.albumArtist,
        albumArtistMbid: artistEntry?.mbzId || null,
      });
    } catch (err) {
      console.warn("[manual-organizer] album nfo error:", err);
    }
  }

  // ── Regenerate artist.nfo ──

  for (const [, artist] of artistMap) {
    try {
      const targetArtistDir = joinPaths(libraryRoot, sanitize(artist.name));

      await electronFs.deleteFile(joinPaths(targetArtistDir, "artist.nfo")).catch(() => {});

      await organizer.writeArtistArtifacts(targetArtistDir, {
        artistName: artist.name,
        genres: artist.genres,
        mbid: artist.mbzId,
        sortName: artist.sortName,
        type: artist.type,
        disambiguation: artist.disambiguation,
      });
    } catch (err) {
      console.warn("[manual-organizer] artist nfo error:", err);
    }
  }

  addMsg("Metadata files updated", "success");

  return { organizedCount, failedCount, skippedCount, results };
}
