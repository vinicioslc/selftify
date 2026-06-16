import type { Song, Album, AlbumArtist } from "../types/domain-types";
import { OriginType } from "../types/domain-types";
import { fetchAlbumCover, clearImageQueue } from "./image-fetch";
import { fetchArtistImage } from "./artist-image";
import { useStatusStore } from "../stores/status.store";

export type CoverArtCallbacks = {
  onAlbumCover: (albumId: string, url: string | null) => void;
  onAlbumCoverDone: (albumId: string) => void;
  onSongCover: (songIds: string[], url: string | null) => void;
  onSongCoverDone: (songIds: string[]) => void;
  onArtistImage?: (artistId: string, url: string | null) => void;
  /** Called synchronously inside searchMusicBrainz BEFORE the FIFO queue starts.
   *  Use this to initialise loading states so callbacks never fire before the
   *  state is set. */
  onLoadingReady?: (albumIds: string[], songIds: string[]) => void;
};

export async function searchMusicBrainz(
  q: string,
  limit: number,
  originId: string,
  callbacks?: CoverArtCallbacks,
): Promise<{ songs: Song[]; albums: Album[]; albumArtists: AlbumArtist[] }> {
  const { searchRecordings, searchReleases, searchArtists } = await import("./musicbrainz-client");
  const [rr, relR, arR] = await Promise.all([
    searchRecordings("", "", { rawQuery: q, limit }),
    searchReleases("", "", { rawQuery: q, limit: Math.min(limit, 5) }),
    searchArtists("", { rawQuery: q, limit: Math.min(limit, 5) }),
  ]);

  const songs: Song[] = (rr.recordings ?? []).map((r) => ({
    id: `mbz-rec-${r.id}`,
    originId,
    originType: OriginType.LOCAL,
    name: r.title,
    artistName: r["artist-credit"]?.[0]?.name || "Unknown Artist",
    albumName: r.releases?.[0]?.title || undefined,
    duration: r.length ? Math.round(r.length / 1000) : null,
    imageUrl: null,
    mbzRecordingId: r.id,
    mbzArtistId: r["artist-credit"]?.[0]?.artist?.id,
  }));

  const albums: Album[] = (relR.releases ?? [])
    .filter((rel) => rel["cover-art-archive"]?.front === true)
    .map((rel) => ({
      id: `mbz-rel-${rel.id}`,
      originId,
      originType: OriginType.LOCAL,
      name: rel.title,
      albumArtistName: rel["artist-credit"]?.[0]?.name || "Unknown Artist",
      releaseYear: rel.date ? parseInt(rel.date.slice(0, 4), 10) : undefined,
      imageUrl: null,
      mbzId: rel.id,
      mbzReleaseGroupId: rel["release-group"]?.id,
    }));

  const albumArtists: AlbumArtist[] = (arR.artists ?? []).map((a) => ({
    id: `mbz-art-${a.id}`,
    originId,
    originType: OriginType.LOCAL,
    name: a.name,
    imageUrl: null,
    mbz: a.id,
  }));

  // Call onLoadingReady synchronously BEFORE the queue starts, so the
  // component can initialise loading states without a race condition.
  if (callbacks?.onLoadingReady) {
    const albumIds = albums.map((a) => a.id);
    const songIds = songs.filter((s) => s.albumName).map((s) => s.id);
    callbacks.onLoadingReady(albumIds, songIds);
  }

  // Queue all cover-art tasks in FIFO order and process sequentially.
  // Albums first (top to bottom), then songs (top to bottom), then artists.
  if (callbacks) {
    queueCoverArtTasks(albums, rr.recordings ?? [], albumArtists, callbacks);
  }

  return { songs, albums, albumArtists };
}

// ── FIFO Cover-Art Queue ──
// Processes items one at a time, top to bottom, so the first album finishes
// before the next starts. This avoids infinite spinners by always calling
// the "done" callback for every item, even when there is no ID to fetch.

type CoverTask =
  | { type: "album"; album: Album }
  | { type: "song-group"; rgId?: string | null; relId?: string | null; ids: string[]; artist: string; album: string }
  | { type: "artist"; artist: AlbumArtist };

const COVER_QUEUE_DELAY_MS = 1200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queueCoverArtTasks(
  albums: Album[],
  recordings: any[],
  artists: AlbumArtist[],
  cb: CoverArtCallbacks,
  songs?: Song[], // fallback when recordings is empty (cached results)
): void {
  const queue: CoverTask[] = [];

  // 1. Albums in order
  for (const album of albums) {
    queue.push({ type: "album", album });
  }

  // 2. Deduplicated song groups in order
  // Only fetch covers for releases that actually have cover art in the archive,
  // matching the same filter used for albums above.
  const seen = new Map<string, {
    ids: string[]; rgId?: string; relId?: string; artist: string; album: string;
  }>();
  if (recordings.length > 0) {
    // From raw API data — has release-group / release IDs
    for (const r of recordings) {
      const release = r.releases?.[0];
      // Skip recordings whose release has no cover art
      if (!release?.["cover-art-archive"]?.front) continue;
      const rgId = release?.["release-group"]?.id;
      const relId = release?.id;
      // Skip if neither ID is available (nothing to fetch)
      if (!rgId && !relId) continue;
      const key = rgId || relId;
      const entry = seen.get(key) || { ids: [] as string[], rgId, relId, artist: "", album: "" };
      entry.ids.push(`mbz-rec-${r.id}`);
      if (!entry.artist) entry.artist = r["artist-credit"]?.[0]?.name || r.title;
      if (!entry.album) entry.album = release?.title || "";
      if (rgId && !entry.rgId) entry.rgId = rgId;
      if (relId && !entry.relId) entry.relId = relId;
      seen.set(key, entry);
    }
  } else if (songs && songs.length > 0) {
    // Fallback from cached Song objects — group by artist+album as proxy
    for (const song of songs) {
      const key = `${song.artistName}::${song.albumName || ""}`;
      const entry = seen.get(key) || { ids: [] as string[], artist: song.artistName, album: song.albumName || "" };
      entry.ids.push(song.id);
      seen.set(key, entry);
    }
  }
  for (const [, entry] of seen) {
    queue.push({ type: "song-group", ...entry });
  }

  // 3. Artists in order
  for (const artist of artists) {
    queue.push({ type: "artist", artist });
  }

  // Process queue sequentially (FIFO)
  processQueue(queue, cb);
}

async function processQueue(queue: CoverTask[], cb: CoverArtCallbacks): Promise<void> {
  useStatusStore.getState().addMessage(`MusicBrainz image queue started (${queue.length})`, "info", "Images");
  for (const [index, task] of queue.entries()) {
    try {
      const position = `${index + 1}/${queue.length}`;
      if (task.type === "album") {
        const a = task.album;
        const mbzIds = [`rg=${a.mbzReleaseGroupId || '—'}`, `rel=${a.mbzId || '—'}`].join(', ');
        console.debug(`[search] cover queue ${position} album "${a.name}" (${mbzIds})`);
        useStatusStore.getState().addMessage(`📀 Album cover ${position}: ${a.name} (${mbzIds})`, "info", "Images");
        const url = await fetchAlbumCover(a.mbzReleaseGroupId, a.mbzId, a.albumArtistName, a.name);
        const src = url ? url.slice(0, 60) : '❌ none';
        useStatusStore.getState().addMessage(`✅ Album cover for "${a.name}": ${src}`, "success", "Images");
        cb.onAlbumCover(a.id, url);
        cb.onAlbumCoverDone(a.id);
      } else if (task.type === "song-group") {
        const mbzIds = [`rg=${task.rgId || '—'}`, `rel=${task.relId || '—'}`].join(', ');
        console.debug(`[search] cover queue ${position} song group "${task.artist} - ${task.album || '?'}" (${mbzIds})`);
        useStatusStore.getState().addMessage(`🎵 Song thumbnail ${position}: "${task.artist} - ${task.album || '?'}" (${mbzIds})`, "info", "Images");
        const url = await fetchAlbumCover(task.rgId, task.relId, task.artist, task.album);
        const src = url ? url.slice(0, 60) : '❌ none (no cover in archive)';
        useStatusStore.getState().addMessage(`✅ Song thumbnail "${task.artist} - ${task.album || '?'}": ${src}`, "success", "Images");
        cb.onSongCover(task.ids, url);
        cb.onSongCoverDone(task.ids);
      } else if (task.type === "artist") {
        const art = task.artist;
        console.debug(`[search] cover queue ${position} artist "${art.name}" (mbz=${art.mbz || '—'})`);
        useStatusStore.getState().addMessage(`👤 Artist image ${position}: ${art.name}`, "info", "Images");
        const url = await fetchArtistImage(art.name, art.mbz || undefined);
        const src = url ? url.slice(0, 60) : '❌ none (Wikipedia)';
        if (url && cb.onArtistImage) {
          useStatusStore.getState().addMessage(`✅ Artist image for "${art.name}": ${src}`, "success", "Images");
          cb.onArtistImage(art.id, url);
        }
      }
    } catch (err) {
      console.warn("[search] cover task error:", err);
      // Always call done, even on error
      if (task.type === "album") {
        cb.onAlbumCoverDone(task.album.id);
      } else if (task.type === "song-group") {
        cb.onSongCoverDone(task.ids);
      }
      // Artists have no done callback — ignored on error
    }
    if (index < queue.length - 1) {
      await delay(COVER_QUEUE_DELAY_MS);
    }
  }
  useStatusStore.getState().addMessage("MusicBrainz image queue finished", "success", "Images");
}

/**
 * Kick off the cover-art FIFO queue for MusicBrainz results.
 * Used when restoring cached results — re-runs image fetching without
 * re-fetching from the MusicBrainz API.
 */
export function startCoverQueue(
  songs: Song[],
  albums: Album[],
  albumArtists: AlbumArtist[],
  cb: CoverArtCallbacks,
): void {
  if (cb.onLoadingReady) {
    const albumIds = albums.map((a) => a.id);
    const songIds = songs.filter((s) => s.albumName).map((s) => s.id);
    cb.onLoadingReady(albumIds, songIds);
  }
  queueCoverArtTasks(albums, [], albumArtists, cb, songs);
}

export { clearImageQueue };
