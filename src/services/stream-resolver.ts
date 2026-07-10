import type { Song } from "../types/domain-types";
import { OriginType, OriginType as OriginTypeEnum } from "../types/domain-types";
import { getSongByMbid, getSongById, getSongByNameAndArtist } from "../api/local/local-queries";
import { getStreamUrl } from "./youtube-download-service";
import { getSavedMbzYtMapping, setSavedMbzYtMapping } from "./sqlite-db/sqlite-db-mappings";
import type { MbzYtMapping } from "./sqlite-db/sqlite-db-mappings";
import type { StreamSourceCandidate } from "../types/domain-types";
import { useStatusStore } from "../stores/status.store";
import { sqliteDbTrackToSong } from "./sqlite-db/sqlite-db-resolver";
import { getPlatformService } from "./platform/factory";
import { getLibraryRoot } from "./db/ensure-db";
import { joinPaths, isAbsolutePath, normalizePath } from "../lib/path-utils";

export type ResolveResult = {
  song: Song;
  source: "local" | "youtube" | "none";
};

function addMsg(text: string, level: "info" | "success" | "warn" | "danger" = "info") {
  useStatusStore.getState().addMessage(text, level, "Player");
}

function log(msg: string) {
  console.debug(`[stream-resolver] ${msg}`);
}

/**
 * Find local songs in the database that match the given song.
 * Tries mbzRecordingId first, then falls back to name+artist match.
 */
export async function findLocalCandidates(
  mbzRecordingId: string,
  originId: string,
  songName?: string,
  artistName?: string,
): Promise<StreamSourceCandidate[]> {
  let track = await getSongByMbid(mbzRecordingId);

  if (!track && songName && artistName) {
    track = await getSongByNameAndArtist(songName, artistName);
  }

  if (!track) return [];
  const song = sqliteDbTrackToSong(track, originId, OriginType.LOCAL);
  return [{ type: "local", song, filePath: track.path }];
}

/**
 * Find a single local song by mbzRecordingId.
 */
export async function findLocalSongByMbid(mbzRecordingId: string, originId: string): Promise<Song | null> {
  const track = await getSongByMbid(mbzRecordingId);
  if (!track) return null;
  return sqliteDbTrackToSong(track, originId, OriginType.LOCAL);
}

/**
 * Resolve a playable song path using local-first strategy:
 * 1. If song.path already exists → use it directly (local)
 * 2. If song.mbzRecordingId → check for local file with same MBZ ID
 * 3. If local file found → use it (auto-select, save preference)
 * 4. If saved preference in MbzYtMapping → respect it
 * 5. Otherwise → YouTube search + stream extraction
 *
 * @param manualVideoId Optional YouTube video ID to force a specific video
 */
export async function resolveSong(song: Song, manualVideoId?: string): Promise<ResolveResult> {
  // When a backend (Selftify/Subsonic server) owns the library, song.path is a
  // server-relative path, not a local file — never validate it against the
  // local filesystem (and never delete local DB tracks for it).
  const { useBackendStore } = await import("../stores/backend.store");
  const isBackend = !!useBackendStore.getState().config;

  // Step 1: path already set (local file or pre-resolved stream)
  if (song.path) {
    // Only check file existence for local files, not stream URLs
    if (song.originType === OriginType.LOCAL && !song.path.startsWith("http") && !isBackend) {
      const root = getLibraryRoot();
      const absPath = isAbsolutePath(song.path) ? song.path : root ? joinPaths(root, song.path) : song.path;
      const p = await getPlatformService();
      const exists = absPath ? await p.fileExists(absPath) : false;
      if (!exists) {
        addMsg(`File not found: ${song.name} — removed from library`, "warn");
        log(`file not found, removing from DB: ${absPath}`);
        try {
          const { deleteTrack } = await import("./db/repositories/track-repo");
          const { flushSave } = await import("./db/database");
          const relPath = isAbsolutePath(song.path) && root ? normalizePath(song.path.slice(root.length + 1)) : normalizePath(song.path);
          deleteTrack(relPath);
          await flushSave();
        } catch (err) {
          console.warn("[stream-resolver] failed to remove missing file from DB:", err);
        }
        return { song: { ...song, path: undefined }, source: "none" };
      }
    }
    return { song, source: "local" };
  }

  // Step 1b: cached youtubeVideoId → resolve stream URL directly (skip search)
  if (song.youtubeVideoId) {
    log(`using cached youtubeVideoId=${song.youtubeVideoId}`);
    addMsg("Resolving cached YouTube stream...", "info");
    const streamUrl = await getStreamUrl(song);
    if (streamUrl) {
      return { song: { ...song, path: streamUrl }, source: "youtube" };
    }
  }

  // Step 2: try to find local file by MBZ ID
  if (song.mbzRecordingId) {
    // Check saved preference first
    const mapping = await getSavedMbzYtMapping(song.mbzRecordingId);
    if (mapping?.selectedSource === "local" && mapping.localSongId) {
      const localTrack = await getSongById(mapping.localSongId);
      if (localTrack?.path) {
        const localSong = sqliteDbTrackToSong(localTrack, song.originId, OriginType.LOCAL);
        log(`using saved local selection: ${localSong.path}`);
        addMsg("Playing local file (saved preference)", "info");
        return { song: localSong, source: "local" };
      }
    }

    // Auto-detect: query local DB for same MBZ ID
    const localSong = await findLocalSongByMbid(song.mbzRecordingId, song.originId);
    if (localSong?.path) {
      log(`auto-selected local file: ${localSong.path}`);
      // Save preference for future plays
      if (song.mbzRecordingId) {
        saveLocalPreference(song.mbzRecordingId, localSong, mapping);
      }
      addMsg("Playing local file", "info");
      return { song: localSong, source: "local" };
    }

    // Step 3: use manual video ID if provided (from SongInfoDialog selection)
    if (manualVideoId) {
      const streamUrl = await getStreamUrl(song);
      if (streamUrl) {
        return { song: { ...song, path: streamUrl }, source: "youtube" };
      }
    }

    // Step 4: if saved source is youtube, respect it
    if (mapping?.selectedSource === "youtube") {
      const streamUrl = await getStreamUrl(song);
      if (streamUrl) {
        return { song: { ...song, path: streamUrl }, source: "youtube" };
      }
    }
  }

  // Step 5: fall back to YouTube
  const streamUrl = await getStreamUrl(song);
  if (streamUrl) {
    return { song: { ...song, path: streamUrl }, source: "youtube" };
  }

  // Nothing worked
  return { song, source: "none" };
}

/**
 * Resolve multiple songs in parallel.
 */
export async function resolveSongs(songs: Song[]): Promise<ResolveResult[]> {
  return Promise.allSettled(
    songs.map((s) => resolveSong(s))
  ).then((results) =>
    results.map((r) =>
      r.status === "fulfilled" ? r.value : { song: songs[results.indexOf(r)], source: "none" as const }
    )
  );
}

async function saveLocalPreference(mbzRecordingId: string, localSong: Song, existingMapping?: MbzYtMapping | null) {
  try {
    const now = Date.now();
    if (existingMapping) {
      await setSavedMbzYtMapping({
        ...existingMapping,
        selectedSource: "local",
        localSongId: localSong.id,
        selectedVideoId: existingMapping.selectedVideoId,
        selectedType: "auto",
        updatedAt: now,
      });
    } else {
      await setSavedMbzYtMapping({
        mbzRecordingId,
        songName: localSong.name,
        artistName: localSong.artistName,
        albumName: localSong.albumName,
        albumImageUrl: localSong.imageUrl,
        selectedVideoId: localSong.id,
        selectedType: "auto",
        selectedSource: "local",
        localSongId: localSong.id,
        candidates: [],
        createdAt: now,
        updatedAt: now,
      });
    }
    log("local preference saved");
  } catch (err) {
    console.warn("[stream-resolver] failed to save local preference:", err);
  }
}
