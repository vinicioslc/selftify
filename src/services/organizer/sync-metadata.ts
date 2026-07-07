import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { OriginType } from "../../types/domain-types";
import { sanitizeForPath } from "./sanitizer";
import { getPlatformService } from "../platform/factory";
import { isAudioFile } from "../../lib/sqlite-db-helpers";
import { joinPaths } from "../../lib/path-utils";
import type { SqliteDbImage, SqliteDbAlbumTrack } from "../sqlite-db/sqlite-db-types";
import { getCoverForAlbum } from "./cover-utils";

export type SyncMetadataResult = {
  albumsProcessed: number;
  filesUpdated: number;
  skippedCount: number;
  failedCount: number;
};

function cleanTrackTitle(
  rawTitle: string,
  artistName: string,
  albumName: string,
  fallbackTitle: string,
): string {
  let title = rawTitle || fallbackTitle;

  // Detect and strip the "Artist - Album - " prefix that the organizer adds to filenames.
  // Pattern: "Artist - Album - NN - Title" → extract "NN - Title" or just "Title"
  // On repeated cycles: "Artist - Album - Artist - Album - ... - NN - Title" → still extract the tail
  const artistNorm = artistName.toLowerCase().trim();
  const albumNorm = albumName.toLowerCase().trim();
  const parts = title.split(" - ").map((p) => p.trim()).filter(Boolean);

  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];

    // Check if the first part matches the artist name → this is a concatenated filename artifact
    if (parts[0].toLowerCase() === artistNorm) {
      // Second-to-last might be a track number (e.g. "01") — keep as prefix
      if (/^\d+$/.test(secondLast) || /^\d+-/.test(secondLast)) {
        return `${secondLast} - ${lastPart}`;
      }
      return lastPart;
    }

    // Also check if the first two parts match "Artist - Album"
    if (parts.length >= 4 && parts[0].toLowerCase() === artistNorm && parts[1].toLowerCase() === albumNorm) {
      if (/^\d+$/.test(secondLast) || /^\d+-/.test(secondLast)) {
        return `${secondLast} - ${lastPart}`;
      }
      return lastPart;
    }
  }

  return title;
}

async function updateAudioMetadata(
  electronApi: any,
  audioPath: string,
  dbTrack: SqliteDbAlbumTrack | undefined,
  albumMeta: { name: string; artistName: string; albumArtist: string | null; releaseYear: number | null },
  coverPath: string | null,
): Promise<boolean> {
  const filenameTitle = audioPath.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
  const cleanTitle = dbTrack
    ? cleanTrackTitle(dbTrack.name, dbTrack.artistName, dbTrack.albumName || albumMeta.name, filenameTitle)
    : filenameTitle;

  const metadata = {
    title: cleanTitle,
    artist: dbTrack?.artistName || albumMeta.artistName,
    album: dbTrack?.albumName || albumMeta.name,
    albumArtist: albumMeta.albumArtist || albumMeta.artistName,
    trackNumber: dbTrack?.trackNumber ?? undefined,
    discNumber: dbTrack?.discNumber ?? undefined,
    releaseYear: albumMeta.releaseYear ?? undefined,
    genre: dbTrack?.genre ?? undefined,
    mbzRecordingId: dbTrack?.mbzRecordingId ?? undefined,
  };

  if (coverPath) {
    return electronApi.local.replaceCover({ audioPath, coverPath, metadata });
  }

  return electronApi.local.updateMetadata({ audioPath, metadata });
}

export async function syncAlbumMetadata(): Promise<SyncMetadataResult> {
  const addMsg = (text: string, level: "info" | "success" | "warn" | "danger" = "info") =>
    useStatusStore.getState().addMessage(text, level, "Library");

  const origin = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL);
  const libraryRoot = origin?.folderPath;
  if (!libraryRoot) {
    addMsg("No local library configured", "warn");
    return { albumsProcessed: 0, filesUpdated: 0, skippedCount: 0, failedCount: 0 };
  }

  const db = await import("../db/database");
  if (!db.isReady()) {
    try {
      await db.initDatabase(libraryRoot);
    } catch {
      addMsg("Library database not available", "warn");
      return { albumsProcessed: 0, filesUpdated: 0, skippedCount: 0, failedCount: 0 };
    }
  }

  const albumRepo = await import("../db/repositories/album-repo");
  const artistRepo = await import("../db/repositories/artist-repo");
  const { upsertCoverCache } = await import("../db/repositories/cover-cache-repo");
  const { ensureDbWithRoot } = await import("../db/ensure-db");
  const { createFileOrganizer } = await import("./file-organizer");
  const { sanitizeForPath: sanitize } = await import("./sanitizer");
  await ensureDbWithRoot(libraryRoot);

  const albums = albumRepo.getAllAlbums();
  if (albums.length === 0) {
    addMsg("No albums found — library is empty", "info");
    return { albumsProcessed: 0, filesUpdated: 0, skippedCount: 0, failedCount: 0 };
  }

  const p = await getPlatformService();
  if (p.isWeb) {
    addMsg("Metadata sync not available on web platform", "warn");
    return { albumsProcessed: 0, filesUpdated: 0, skippedCount: 0, failedCount: 0 };
  }

  const electronApi = (window as any).electronApi;
  if (!electronApi?.local?.replaceCover || !electronApi?.local?.updateMetadata) {
    addMsg("Electron API not available — replaceCover/updateMetadata required", "warn");
    return { albumsProcessed: 0, filesUpdated: 0, skippedCount: 0, failedCount: 0 };
  }

  const organizer = createFileOrganizer(libraryRoot);
  const allArtists = artistRepo.getAllArtists();
  const artistMap = new Map(allArtists.map((a) => [a.name.toLowerCase(), a]));

  let albumsProcessed = 0;
  let filesUpdated = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const totalAlbums = albums.length;

  addMsg(`Syncing metadata for ${totalAlbums} albums...`, "info");

  for (let i = 0; i < albums.length; i++) {
    const { meta, artistDir } = albums[i];
    const albumDirBase = sanitizeForPath(meta.name);
    const albumDir = meta.releaseYear ? `${albumDirBase} (${meta.releaseYear})` : albumDirBase;
    const targetAlbumDir = joinPaths(libraryRoot, artistDir, albumDir);

    try {
      const dirExists = await p.fileExists(targetAlbumDir);
      if (!dirExists) {
        skippedCount++;
        continue;
      }

      // ── Pick best cover (prefers .img/ over DB) ──
      const coverResult = await getCoverForAlbum(libraryRoot, targetAlbumDir, meta.images?.[0]?.id || null);
      const coverPath = coverResult?.path ?? null;

      // ── Find audio files in the album directory ──
      const albumDirEntries = await p.readDirectory(targetAlbumDir);
      const audioFiles = albumDirEntries.filter((e) => e.isFile && isAudioFile(e.name));

      if (audioFiles.length === 0) {
        skippedCount++;
        continue;
      }

      // ── Build track lookup by relative path ──
      const trackByRelPath = new Map<string, SqliteDbAlbumTrack>();
      for (const track of meta.tracks) {
        if (track.path) {
          trackByRelPath.set(track.path, track);
        }
      }

      // ── Update metadata on each audio file ──
      let albumUpdatedCount = 0;
      for (const audioFile of audioFiles) {
        const relPath = joinPaths(artistDir, albumDir, audioFile.name);
        const dbTrack = trackByRelPath.get(relPath);

        const success = await updateAudioMetadata(
          electronApi,
          audioFile.path,
          dbTrack,
          {
            name: meta.name,
            artistName: meta.artistName,
            albumArtist: meta.albumArtist,
            releaseYear: meta.releaseYear,
          },
          coverPath,
        );

        if (success) {
          albumUpdatedCount++;
        } else {
          failedCount++;
        }
      }

      // ── Update DB album images + cover_cache if cover was found ──
      if (coverResult) {
        const { sha256Hash, saveSqliteDbImage } = await import("../sqlite-db/sqlite-db-image");
        const hash = await sha256Hash(coverResult.data.buffer as ArrayBuffer);
        const imageRelPath = await saveSqliteDbImage(libraryRoot, "album", hash, coverResult.data, coverResult.mime);

        const newImage: SqliteDbImage = {
          id: imageRelPath,
          url: imageRelPath,
          width: null,
          height: null,
          format: coverResult.mime as "image/jpeg" | "image/png" | "image/webp",
        };
        meta.images = [newImage, ...(meta.images || [])];
        db.exec(
          "UPDATE albums SET images = ?, updated_at = ? WHERE id = ?",
          [JSON.stringify(meta.images), Date.now(), `${artistDir}/${meta.name}`],
        );
        upsertCoverCache(meta.artistName, meta.name, hash, coverResult.mime, coverResult.path);
      }

      if (albumUpdatedCount > 0) {
        filesUpdated += albumUpdatedCount;
        albumsProcessed++;

        // ── Regenerate album.nfo ──
        try {
          const artistEntry = artistMap.get(meta.artistName.toLowerCase());
          await p.deleteFile(joinPaths(targetAlbumDir, "album.nfo")).catch(() => {});
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
        } catch (nfoErr) {
          console.warn(`[sync-metadata] album.nfo error for ${meta.name}:`, nfoErr);
        }
      } else {
        skippedCount++;
      }
    } catch (err) {
      console.warn(`[sync-metadata] failed for ${meta.artistName} - ${meta.name}:`, err);
      failedCount++;
    }

    if ((i + 1) % 10 === 0 || i === albums.length - 1) {
      addMsg(`Syncing metadata... ${i + 1}/${totalAlbums}`, "info");
    }
  }

  // ── Regenerate artist.nfo for all artists ──
  addMsg("Updating artist metadata files...", "info");
  for (const [, artist] of artistMap) {
    try {
      const targetArtistDir = joinPaths(libraryRoot, sanitize(artist.name));
      await p.deleteFile(joinPaths(targetArtistDir, "artist.nfo")).catch(() => {});
      await organizer.writeArtistArtifacts(targetArtistDir, {
        artistName: artist.name,
        genres: artist.genres,
        mbid: artist.mbzId,
        sortName: artist.sortName,
        type: artist.type,
        disambiguation: artist.disambiguation,
      });
    } catch (nfoErr) {
      console.warn(`[sync-metadata] artist.nfo error for ${artist.name}:`, nfoErr);
    }
  }

  db.flushSave();

  if (filesUpdated > 0) {
    addMsg(`Updated metadata for ${filesUpdated} file(s) across ${albumsProcessed} album(s)`, "success");
  }
  if (skippedCount > 0) {
    addMsg(`${skippedCount} album(s) skipped`, "info");
  }
  if (failedCount > 0) {
    addMsg(`${failedCount} file(s) failed`, "warn");
  }

  return { albumsProcessed, filesUpdated, skippedCount, failedCount };
}