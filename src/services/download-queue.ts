import { normalizePath, joinPaths } from "../lib/path-utils";
import type { Song, DownloadTask } from "../types/domain-types";
import { DownloadStatus, OriginType } from "../types/domain-types";
import { useDownloadStore } from "../stores/download.store";
import { useAuthStore } from "../stores/auth.store";
import { useOnlineSearchStore } from "../stores/online-search.store";
import { useStatusStore } from "../stores/status.store";
import { getDownloadPlatform } from "./download-platform";
import { searchAndRank } from "./youtube-download-service";
import type { MBArtist, MBRecording } from "./musicbrainz-types";
import type { MusicBrainzContext } from "./musicbrainz-types";

const MB_TIMEOUT = 5000;

type MbMetadata = {
  artistName: string;
  albumName?: string;
  albumArtistName?: string;
  trackNumber?: number;
  discNumber?: number;
  releaseYear?: number;
  genres?: string[];
  mbzRecordingId?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzReleaseId?: string;
};

async function resolveMbMetadata(song: Song): Promise<MbMetadata> {
  let artistName = song.artistName || "Unknown";
  let albumName = song.albumName;
  let albumArtistName = song.albumArtistName;
  let trackNumber = song.trackNumber;
  let discNumber = song.discNumber;
  let releaseYear = song.releaseYear;
  let genres = song.genres ? [...song.genres] : [];
  let mbzRecordingId = song.mbzRecordingId;
  let mbzArtistId = song.mbzArtistId;
  let mbzReleaseGroupId: string | undefined;
  let mbzReleaseId: string | undefined;

  const origin = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL);
  const mbCtx: MusicBrainzContext | undefined = origin?.folderPath
    ? { artistName }
    : undefined;

  if (mbzRecordingId) {
    try {
      const { getRecordingDetail } = await import("./musicbrainz-client");
      const recording = await Promise.race([
        getRecordingDetail(mbzRecordingId, mbCtx),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), MB_TIMEOUT),
        ),
      ]) as MBRecording | null;
      if (recording) {
        const mbArtist = recording["artist-credit"]?.[0];
        if (mbArtist?.artist?.name) {
          artistName = mbArtist.artist.name;
          mbzArtistId = mbArtist.artist.id;
        } else if (mbArtist?.name) {
          artistName = mbArtist.name;
        }

        const release = recording.releases?.[0];
        if (release) {
          if (!albumName && release.title) albumName = release.title;
          mbzReleaseId = release.id;
          mbzReleaseGroupId = release["release-group"]?.id;

          // Fetch full release detail for track/disc metadata
          if (release.id) {
            try {
              const { getReleaseDetail } = await import("./musicbrainz-client");
              const fullRelease = await Promise.race([
                getReleaseDetail(release.id, mbCtx),
                new Promise<null>((_, reject) =>
                  setTimeout(() => reject(new Error("timeout")), MB_TIMEOUT),
                ),
              ]) as any;
              if (fullRelease) {
                if (fullRelease.date && !releaseYear) {
                  const y = parseInt(fullRelease.date.slice(0, 4), 10);
                  if (!isNaN(y)) releaseYear = y;
                }
                if (fullRelease["artist-credit"]?.[0]?.name) {
                  albumArtistName = fullRelease["artist-credit"][0].name;
                }
                // Extract track/disc from media
                const media = fullRelease.media;
                if (media && media.length > 0) {
                  for (const medium of media) {
                    const tracks = medium.tracks;
                    if (!tracks) continue;
                    for (const t of tracks) {
                      if (t.recording?.id === mbzRecordingId) {
                        trackNumber = parseInt(t.number, 10) || trackNumber;
                        discNumber = parseInt(medium.position, 10) || discNumber;
                        break;
                      }
                    }
                  }
                }
              }
            } catch {
              // non-critical
            }
          }
        }
      }
    } catch (err) {
      console.warn("[resolveMbMetadata] recording lookup failed:", err);
    }
  }

  // Fetch artist tags if no genres yet
  if (mbzArtistId && genres.length === 0) {
    try {
      const { getArtistDetail } = await import("./musicbrainz-client");
      const artist = await Promise.race([
        getArtistDetail(mbzArtistId, mbCtx),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), MB_TIMEOUT),
        ),
      ]) as MBArtist | null;
      if (artist?.name && artistName === (song.artistName || "Unknown")) {
        artistName = artist.name;
      }
      if (artist?.tags && artist.tags.length > 0) {
        genres = artist.tags
          .filter((t) => t.count > 0)
          .map((t) => t.name)
          .slice(0, 5);
      }
    } catch (err) {
      console.warn("[resolveMbMetadata] artist lookup failed:", err);
    }
  }

  return {
    artistName,
    albumName,
    albumArtistName,
    trackNumber,
    discNumber,
    releaseYear,
    genres,
    mbzRecordingId,
    mbzArtistId,
    mbzReleaseGroupId,
    mbzReleaseId,
  };
}

function getDownloadFolder(song: Song): string {
  const origin = useAuthStore.getState().origins.find((o) => o.id === song.originId);
  return origin?.downloadFolder || useOnlineSearchStore.getState().downloadFolder || "";
}

function computeExpectedFilePath(folder: string, meta: MbMetadata, songName: string): string {
  const safeArtist = (meta.artistName || "Unknown").replace(/[<>:"/\\|?*]/g, '_');
  const safeTitle = (songName || "Unknown").replace(/[<>:"/\\|?*]/g, '_');

  const prefix = meta.trackNumber
    ? `${String(meta.trackNumber).padStart(2, '0')} - `
    : '';

  let albumDir: string;
  if (meta.albumName) {
    const safeAlbum = meta.albumName.replace(/[<>:"/\\|?*]/g, '_');
    albumDir = meta.releaseYear ? `${safeAlbum} (${meta.releaseYear})` : safeAlbum;
  } else {
    albumDir = `${safeTitle} (Single)`;
  }

  const filename = `${prefix}${safeTitle}`;
  return joinPaths(folder, safeArtist, albumDir, `${filename}.mp3`);
}

async function resolveCoverBytes(
  song: Song,
  videoId: string,
  mbArtistName: string,
  mbAlbumName?: string,
): Promise<number[] | null> {
  // 1. Centralized resolveAlbumCover pipeline — tries .img/ → IndexedDB → Deezer → iTunes
  if (mbArtistName) {
    try {
      const { resolveAlbumCover } = await import("./cover-resolver");
      const result = await resolveAlbumCover({
        artistName: mbArtistName,
        albumName: mbAlbumName,
        mbzArtistId: song.mbzArtistId,
        mbzReleaseGroupId: song.mbzReleaseGroupId,
        mbzReleaseId: song.mbzAlbumId,
      });
      if (result.blobUrl) {
        const resp = await fetch(result.blobUrl);
        const buf = await resp.arrayBuffer();
        return Array.from(new Uint8Array(buf));
      }
    } catch {
      // fall through
    }
  }

  // 2. song.imageUrl (HTTP) — fetch via main process (CORS-free)
  if (song.imageUrl?.startsWith("http")) {
    const bytes = await fetchImageBytes(song.imageUrl);
    if (bytes) return bytes;
  }

  // 3. song.imageUrl (blob) — fetch in renderer
  if (song.imageUrl?.startsWith("blob:")) {
    try {
      const resp = await fetch(song.imageUrl);
      const buf = await resp.arrayBuffer();
      return Array.from(new Uint8Array(buf));
    } catch {
      // blob may have been revoked
    }
  }

  // 4. Last resort: YouTube video thumbnail
  const api = getElectronApi();
  if (api?.yt?.getVideoInfo) {
    try {
      const info = await api.yt.getVideoInfo(videoId);
      if (info?.thumbnail) {
        const bytes = await fetchImageBytes(info.thumbnail);
        if (bytes) return bytes;
      }
    } catch {
      // thumbnail fetch failed
    }
  }

  return null;
}

async function fetchImageBytes(url: string): Promise<number[] | null> {
  try {
    const api = getElectronApi();
    if (api?.imageFetch) {
      const result = await api.imageFetch(url);
      const body = result?.body;
      if (body && body.length > 0) return body;
    }
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  } catch {
    return null;
  }
}

type FetchResult = {
  status?: number;
  headers?: Record<string, string>;
  body?: number[];
};

type ElectronApi = {
  yt?: { getVideoInfo?: (videoId: string) => Promise<{ thumbnail?: string } | null> };
  imageFetch?: (url: string) => Promise<FetchResult | null>;
};

function getElectronApi(): ElectronApi | null {
  const api = (window as any).electronApi;
  return api || null;
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.substring(0, lastSlash) : filePath;
}

function complete(store: any, taskId: string, extra?: Record<string, unknown>): void {
  store.updateTask(taskId, {
    status: DownloadStatus.COMPLETED,
    progress: 100,
    stepLabel: "Completed",
    completedAt: Date.now(),
    ...extra,
  });
}

async function addDownloadedTrackToLibrary(
  audioPath: string,
  song: Song,
  meta: MbMetadata,
): Promise<void> {
  const origin = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL);
  const libraryRoot = origin?.folderPath;
  if (!libraryRoot || !audioPath.startsWith(libraryRoot)) {
    console.warn("[download-queue] downloaded file outside library root, skipping DB insert");
    return;
  }

  const db = await import("./db/database");
  if (!db.isReady()) {
    console.warn("[download-queue] DB not ready, skipping library insert");
    return;
  }

  const relPath = normalizePath(audioPath.slice(libraryRoot.length + 1));
  const artistName = meta.artistName || song.artistName || "Unknown";
  const albumName = meta.albumName || `${song.name} (Single)`;
  const albumId = `${artistName}/${albumName}`;
  const trackId = `${albumId}/${relPath}`;
  const now = Date.now();

  try {
    // Upsert artist
    db.exec(
      `INSERT OR IGNORE INTO artists (id, name, sort_name, mbz_id, biography, genres, country, type, disambiguation, images, updated_at, enriched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [artistName, artistName, null, meta.mbzArtistId || null, null, JSON.stringify(meta.genres || []), null, null, null, "[]", now, null],
    );

    // Check if album already exists
    const existingAlbum = db.query<{ c: number }>("SELECT COUNT(*) as c FROM albums WHERE id = ?", [albumId]);
    if (existingAlbum[0].c === 0) {
      // Insert new album
      db.exec(
        `INSERT INTO albums (id, artist_id, name, artist_name, album_artist, release_year, mbz_id, mbz_release_group_id, genres, images, song_count, duration, updated_at, enriched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [albumId, artistName, albumName, artistName, meta.albumArtistName || artistName, meta.releaseYear || null, meta.mbzReleaseGroupId || null, meta.mbzReleaseGroupId || null, JSON.stringify(meta.genres || []), "[]", 1, song.duration || 0, now, null],
      );
    }

    // Upsert track
    db.exec(
      `INSERT OR REPLACE INTO tracks (id, album_id, path, name, artist_name, album_name, track_number, disc_number, duration, bitrate, genre, mbz_recording_id, mbz_track_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [trackId, albumId, relPath, song.name, artistName, meta.albumName || null, meta.trackNumber || null, meta.discNumber || null, song.duration || null, song.bitrate ?? null, (meta.genres || []).join(", ") || null, meta.mbzRecordingId || null, null],
    );

    db.flushSave();
    useStatusStore.getState().addMessage(
      `"${song.name}" added to local library`,
      "success",
      "Library",
    );
  } catch (err) {
    console.warn("[download-queue] failed to add to library DB:", err);
  }
}

export async function processTask(task: DownloadTask): Promise<void> {
  const platform = getDownloadPlatform();
  const store = useDownloadStore.getState();
  const folder = getDownloadFolder(task.song);
  if (!folder) {
    throw new Error("No download folder configured for this origin");
  }

  // ── Try backend download first (when Selftify server is available) ──
  try {
    const { useBackendStore } = await import("../stores/backend.store");
    const backendCfg = useBackendStore.getState().config;
    if (backendCfg && useBackendStore.getState().capabilities.includes("download")) {
      const { API_BASE } = await import("../api/base");
      const meta = await resolveMbMetadata(task.song);
      const { searchAndRank: findVideo } = await import("./youtube-download-service");
      store.updateTask(task.id, { status: DownloadStatus.SEARCHING, progress: 5, stepLabel: "Searching YouTube via server..." });
      const match = await findVideo(task.song);
      if (!match) throw new Error("No YouTube match found for this song");
      store.updateTask(task.id, { videoId: match.videoId, progress: 10 });
      store.updateTask(task.id, { status: DownloadStatus.DOWNLOADING_AUDIO, stepLabel: "Downloading via server..." });
      const resp = await fetch(`${API_BASE}/api/selftify/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: match.videoId,
          searchQuery: `${task.song.artistName} ${task.song.name}`,
          songName: task.song.name,
          artistName: meta.artistName,
          albumName: meta.albumName,
          albumArtistName: meta.albumArtistName,
          trackNumber: meta.trackNumber,
          releaseYear: meta.releaseYear,
          genres: meta.genres,
          imageUrl: task.song.imageUrl,
        }),
      });
      const result = await resp.json();
      if (result.success && result.filePath) {
        store.updateTask(task.id, { audioPath: result.filePath, progress: 100, status: DownloadStatus.COMPLETED, stepLabel: "Completed", completedAt: Date.now() });
        return;
      }
      throw new Error(result.error || "Server download failed");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.warn("[download-queue] backend download failed, falling back to local:", msg);
  }

  // ── Fallback: local Electron IPC pipeline ──
  const meta = await resolveMbMetadata(task.song);

  // Check if file already exists on disk — skip download if present
  const expectedPath = computeExpectedFilePath(folder, meta, task.song.name);
  try {
    const exists = await platform.fileExists(expectedPath);
    if (exists) {
      console.log(`[download-queue] file already exists, skipping: ${expectedPath}`);
      store.updateTask(task.id, {
        audioPath: expectedPath,
        status: DownloadStatus.COMPLETED,
        progress: 100,
        stepLabel: "Already downloaded",
        completedAt: Date.now(),
      });
      useStatusStore.getState().addMessage(
        `"${task.song.name}" already exists locally`,
        "info",
        "Download",
      );
      addDownloadedTrackToLibrary(expectedPath, task.song, meta);
      return;
    }
  } catch {
    console.warn(`[download-queue] fileExists check failed for ${expectedPath}, proceeding with download`);
  }

  // Step 1: Search YouTube
  store.updateTask(task.id, {
    status: DownloadStatus.SEARCHING,
    progress: 5,
    stepLabel: "Searching YouTube...",
  });
  const match = await searchAndRank(task.song);
  if (!match) {
    throw new Error("No YouTube match found for this song");
  }
  store.updateTask(task.id, { videoId: match.videoId, progress: 10 });

  // Step 2: Download MP3
  store.updateTask(task.id, {
    status: DownloadStatus.DOWNLOADING_AUDIO,
    stepLabel: "Downloading audio...",
  });
  const audioPath = await platform.downloadAudio({
    videoId: match.videoId,
    songName: task.song.name,
    artistName: meta.artistName,
    albumName: meta.albumName,
    trackNumber: meta.trackNumber,
    discNumber: meta.discNumber,
    releaseYear: meta.releaseYear,
    genres: meta.genres,
    downloadFolder: folder,
  });
  store.updateTask(task.id, { audioPath, progress: 60 });

  // Step 3: Resolve cover source — centralized pipeline first
  store.updateTask(task.id, {
    status: DownloadStatus.GETTING_COVER,
    stepLabel: "Fetching cover art...",
  });
  const coverBytes = await resolveCoverBytes(task.song, match.videoId, meta.artistName, meta.albumName);
  if (!coverBytes) {
    complete(store, task.id);
    addDownloadedTrackToLibrary(audioPath, task.song, meta);
    return;
  }
  store.updateTask(task.id, { progress: 70 });

  // Step 4: Process cover
  store.updateTask(task.id, {
    status: DownloadStatus.PROCESSING_COVER,
    stepLabel: "Processing cover image...",
  });
  const outputDir = dirname(audioPath);
  const coverPath = await platform.processCover({
    imageData: coverBytes,
    outputDir,
  });
  if (!coverPath) {
    complete(store, task.id);
    addDownloadedTrackToLibrary(audioPath, task.song, meta);
    return;
  }
  store.updateTask(task.id, { coverPath, progress: 85 });

  // Step 5: Embed cover + full metadata into MP3
  if (platform.supportsCoverEmbedding) {
    store.updateTask(task.id, {
      status: DownloadStatus.EMBEDDING_COVER,
      stepLabel: "Embedding into MP3...",
    });
    try {
      await platform.embedCover({
        audioPath,
        coverPath,
        metadata: {
          title: task.song.name,
          artist: meta.artistName,
          album: meta.albumName,
          albumArtist: meta.albumArtistName || meta.artistName,
          trackNumber: meta.trackNumber,
          discNumber: meta.discNumber,
          releaseYear: meta.releaseYear,
          genres: meta.genres,
          mbzRecordingId: meta.mbzRecordingId,
          mbzArtistId: meta.mbzArtistId,
          youtubeVideoId: match.videoId,
          youtubeVideoTitle: match.title,
          youtubeChannelName: match.channelName,
        },
      });
    } catch (err) {
      console.warn("[download-queue] cover embed failed, cover.jpg saved separately");
    }
  }

  complete(store, task.id);
  addDownloadedTrackToLibrary(audioPath, task.song, meta);
}
