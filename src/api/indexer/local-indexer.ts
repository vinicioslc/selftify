import type { Indexer, IndexerStatus } from "./indexer";
import type { Origin } from "../../types/domain-types";
import { fileIdFromPath } from "../../stores/local-library.store";
import {
  getScanState,
  updateScanState,
  batchInsertSongs,
  getAllPaths,
  getSongCount,
  deleteSong,
  enqueueScan,
  dequeueScan,
  getQueueCount,
  clearQueue,
  upsertArtist,
  getArtistByName,
  getArtistByMbid,
  type DbSong,
} from "../../services/local-database";
import { storeImage, clear as clearImageCache } from "../../services/image-cache";
import { useStatusStore } from "../../stores/status.store";
import type { PlatformService, DirEntry } from "../../services/platform/types";

/** Publish a status message to the global TopBar status store.
 *  Safe to call outside React (uses Zustand getState()). */
function publishStatus(text: string, level: "info" | "success" | "warn" | "danger" = "info", source = "Local Scan") {
  try {
    useStatusStore.getState().addMessage(text, level, source);
  } catch {
    // silently ignore if store isn't available
  }
}

const DIR_BATCH = 10;
const FILE_BATCH = 5;
const WATCH_INTERVAL = 15000;

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".wma", ".opus", ".aiff", ".alac",
]);

function getAudioExt(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

export function createLocalIndexer(): Indexer {
  let listeners: Array<(status: IndexerStatus) => void> = [];
  let status: IndexerStatus = { status: "idle", progress: { total: 0, done: 0, currentItem: "" } };
  let paused = false;
  let aborted = false;
  let scanning = false;
  let watchTimer: ReturnType<typeof setTimeout> | null = null;
  let scannedCount = 0;
  let platform: PlatformService | null = null;

  /** Tracks unique artists seen during this scan, keyed by normalized name → { name, mbid } */
  const uniqueArtists = new Map<string, { name: string; mbid: string | null }>();

  async function getPlatform(): Promise<PlatformService> {
    if (!platform) {
      const { getPlatformService } = await import("../../services/platform/factory");
      platform = await getPlatformService();
    }
    return platform!;
  }

  function notify() {
    const s = { ...status, progress: { ...status.progress } };
    listeners.forEach((l) => l(s));
  }

  function setState(partial: { status?: IndexerStatus["status"]; progress?: Partial<IndexerStatus["progress"]> }) {
    const mergedProgress = { ...status.progress, ...(partial.progress || {}) } as IndexerStatus["progress"];
    status = { ...status, ...partial, progress: mergedProgress } as IndexerStatus;
    notify();
  }

  // ── Public API ──

  async function start(origin: Origin) {
    const folder = origin.folderPath || "";
    if (!folder) return;

    paused = false;
    aborted = false;
    scanning = false;
    scannedCount = 0;
    uniqueArtists.clear();

    await updateScanState({
      root_folder: folder,
      scan_status: "scanning",
      total_files: 0,
      scanned_files: 0,
      current_dir: folder,
      last_scanned_at: null,
      watcher_enabled: 0,
    });

    setState({ status: "indexing", progress: { total: 0, done: 0, currentItem: folder } });
    publishStatus("Starting local library scan…", "info");

    const existingCount = await getSongCount();

    if (existingCount > 0) {
      await incrementalScan(folder);
    } else {
      await clearImageCache();
      await clearQueue();
      await enqueueScan([{ type: "dir", path: folder }]);
      run();
    }
  }

  async function incrementalScan(root: string) {
    const p = await getPlatform();
    const dbPaths = new Set(await getAllPaths());
    const fsPaths = new Set<string>();
    const pending = [root];
    const visited = new Set<string>();
    const newFiles: string[] = [];

    while (pending.length > 0) {
      if (aborted || paused) return;
      const dir = pending.shift()!;
      if (visited.has(dir)) continue;
      visited.add(dir);
      setState({ progress: { currentItem: dir } });

      let entries: DirEntry[];
      try { entries = await p.readDirectory(dir); } catch { continue; }

      for (const e of entries) {
        if (!e.name) continue;
        if (e.isDirectory) { pending.push(e.path); continue; }
        const ext = getAudioExt(e.name);
        if (!AUDIO_EXTENSIONS.has(ext)) continue;
        fsPaths.add(e.path);
        if (!dbPaths.has(e.path)) newFiles.push(e.path);
      }
    }

    for (const dbPath of dbPaths) {
      if (!fsPaths.has(dbPath)) {
        await deleteSong(fileIdFromPath(dbPath));
      }
    }

    if (newFiles.length > 0) {
      await enqueueScan(newFiles.map((p) => ({ type: "file", path: p })));
      setState({ status: "indexing", progress: { total: newFiles.length, done: 0, currentItem: "" } });
      await updateScanState({ scan_status: "indexing", total_files: newFiles.length, scanned_files: 0 });
      run();
    } else {
      await finish();
    }
  }

  function pause() {
    paused = true;
    setState({ status: "paused" });
  }

  async function resume() {
    if (scanning) return;
    paused = false;
    aborted = false;
    setState({ status: "indexing" });
    run();
  }

  function abort() {
    aborted = true;
    paused = false;
    scanning = false;
    if (watchTimer) clearTimeout(watchTimer);
    updateScanState({ scan_status: "idle", watcher_enabled: 0 });
    setState({ status: "idle" });
  }

  function getStatus() {
    return status;
  }

  async function startWatcher() {
    const state = await getScanState();
    if (state && state.scan_status === "done") {
      await updateScanState({ watcher_enabled: 1 });
      scheduleWatch();
    }
  }

  function onProgress(callback: (s: IndexerStatus) => void) {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((l) => l !== callback);
    };
  }

  // ── Scanner engine ──

  async function run() {
    if (aborted || paused || scanning) return;
    scanning = true;
    await processBatch();
    scanning = false;

    if (aborted) return;

    const remaining = await getQueueCount();
    if (remaining === 0) {
      await finish();
    } else if (!paused) {
      setTimeout(run, 0);
    }
  }

  async function processBatch() {
    let dirs = 0;
    let files = 0;

    while (dirs < DIR_BATCH) {
      if (aborted || paused) return;
      const item = await dequeueScan();
      if (!item) break;

      if (item.type === "dir") {
        await processDir(item.path);
        dirs++;
      } else if (item.type === "file") {
        await processFile(item.path);
        files++;
      }

      if ((dirs + files) % 3 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
      if (files >= FILE_BATCH && dirs >= 1) break;
    }
  }

  async function processDir(dirPath: string) {
    if (aborted) return;
    setState({ progress: { currentItem: dirPath } });

    try {
      const p = await getPlatform();
      const entries = await p.readDirectory(dirPath);
      const subdirs: string[] = [];
      const audioFiles: string[] = [];

      for (const entry of entries) {
        if (aborted) return;
        if (!entry.name) continue;
        if (entry.isDirectory) {
          subdirs.push(entry.path);
        } else if (entry.isFile) {
          const ext = getAudioExt(entry.name);
          if (AUDIO_EXTENSIONS.has(ext)) {
            audioFiles.push(entry.path);
          }
        }
      }

      // If this dir has audio files directly, it's likely an album folder
      if (audioFiles.length > 0) {
        const scanState = await getScanState();
        const rootFolder = scanState?.root_folder || "";
        const relPath = rootFolder ? dirPath.replace(rootFolder, "").replace(/^\/+/, "") : "";
        const pathParts = relPath.split("/").filter(Boolean);
        // Common layout: …/Artist/Album/ or just …/Album/
        if (pathParts.length >= 2) {
          const artistGuess = pathParts[pathParts.length - 2];
          const albumGuess = pathParts[pathParts.length - 1];
          publishStatus(`Indexing ${artistGuess} album list…`, "info");
        }
      }

      const batch: { type: string; path: string }[] = [];
      for (const d of subdirs) batch.push({ type: "dir", path: d });
      for (const f of audioFiles) batch.push({ type: "file", path: f });
      if (batch.length > 0) await enqueueScan(batch);

      scannedCount++;
      await updateScanState({ scanned_files: scannedCount, current_dir: dirPath });
    } catch (err: any) {
      console.warn(`[indexer] error reading dir ${dirPath}:`, err?.message || err);
    }
  }

  async function processFile(filePath: string) {
    if (aborted) return;
    try {
      const p = await getPlatform();
      const data = await p.readFile(filePath);
      if (!data) {
        console.warn(`[indexer] could not read file ${filePath}`);
        return;
      }

      let meta: {
        name: string; artist_name: string; album_name: string | null;
        album_artist: string | null; track_number: number | null; disc_number: number | null;
        duration: number | null; bitrate: number | null; sample_rate: number | null;
        genre: string | null; year: number | null; file_size: number;
        file_extension: string; last_modified: number | null;
        mbz_recording_id: string | null; mbz_track_id: string | null;
        mbz_album_id: string | null; mbz_release_group_id: string | null;
        mbz_artist_id: string | null;
      };

      try {
        const mm = await import("music-metadata");
        const result = await mm.parseBuffer(data, { path: filePath }, { duration: true, skipCovers: false });
        const c = result.common;
        const f = result.format;

        meta = {
          name: c.title || filePath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Unknown",
          artist_name: c.artist || c.albumartist || "Unknown Artist",
          album_name: c.album || null,
          album_artist: c.albumartist || null,
          track_number: c.track?.no || null,
          disc_number: c.disk?.no || null,
          duration: f.duration ? f.duration * 1000 : null,
          bitrate: f.bitrate || null,
          sample_rate: f.sampleRate || null,
          genre: c.genre?.[0] || null,
          year: c.year || null,
          file_size: data.byteLength || data.length,
          file_extension: filePath.split(".").pop()?.toLowerCase() || "",
          last_modified: null,
          mbz_recording_id: c.musicbrainz_recordingid || null,
          mbz_track_id: c.musicbrainz_trackid || null,
          mbz_album_id: c.musicbrainz_albumid || null,
          mbz_release_group_id: c.musicbrainz_releasegroupid || null,
          mbz_artist_id: c.musicbrainz_artistid?.[0] || null,
        };

        const pictures = c.picture || [];
        if (pictures.length > 0) {
          const artistNorm = meta.artist_name.toLowerCase().trim();
          const albumNorm = (meta.album_name || "").toLowerCase().trim();
          const songId = fileIdFromPath(filePath);

          const tags: string[] = [];
          tags.push(`song/${songId}`);
          if (artistNorm) tags.push(`artist/${artistNorm}`);
          if (albumNorm && artistNorm) tags.push(`album/${artistNorm}/${albumNorm}`);

          for (const picture of pictures) {
            try {
              const blob = new Blob([picture.data.slice().buffer], { type: picture.format });
              await storeImage(blob, picture.format, tags);
            } catch (picErr) {
              console.warn(`[indexer] error storing image from ${filePath}:`, picErr);
            }
          }

          // Publish status about cover art indexing
          if (meta.album_name) {
            publishStatus(`Indexing ${meta.artist_name} – ${meta.album_name} image…`, "info");
          }
        }

        // Track artist for later MusicBrainz enrichment
        if (meta.artist_name && meta.artist_name !== "Unknown Artist") {
          const key = meta.artist_name.toLowerCase().trim();
          if (!uniqueArtists.has(key)) {
            uniqueArtists.set(key, {
              name: meta.artist_name,
              mbid: meta.mbz_artist_id || null,
            });
          } else if (meta.mbz_artist_id) {
            // Prefer the first MBID we find for an artist (most complete)
            const existing = uniqueArtists.get(key)!;
            if (!existing.mbid) existing.mbid = meta.mbz_artist_id;
          }
        }
      } catch {
        const fileName = filePath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Unknown";
        const scanState = await getScanState();
        const rootFolder = scanState?.root_folder || "";
        const relPath = rootFolder ? filePath.replace(rootFolder, "").replace(/^\/+/, "") : "";
        const relParts = relPath ? relPath.split("/").filter(Boolean) : [];

        let artist = "Unknown Artist";
        let album: string | null = null;
        if (relParts.length >= 3) { artist = relParts[relParts.length - 3]; album = relParts[relParts.length - 2]; }
        else if (relParts.length === 2) { album = relParts[1]; artist = relParts[0]; }
        else if (relParts.length === 1) { artist = relParts[0]; }

        meta = {
          name: fileName, artist_name: artist, album_name: album,
          album_artist: null, track_number: null, disc_number: null,
          duration: null, bitrate: null, sample_rate: null,
          genre: null, year: null,
          file_size: data.byteLength || data.length,
          file_extension: filePath.split(".").pop()?.toLowerCase() || "",
          last_modified: null,
          mbz_recording_id: null, mbz_track_id: null,
          mbz_album_id: null, mbz_release_group_id: null, mbz_artist_id: null,
        };

        // Track artist from fallback path
        if (artist && artist !== "Unknown Artist") {
          const key = artist.toLowerCase().trim();
          if (!uniqueArtists.has(key)) {
            uniqueArtists.set(key, { name: artist, mbid: null });
          }
        }
      }

      const song: Omit<DbSong, "updated_at"> = {
        id: fileIdFromPath(filePath), path: filePath, name: meta.name,
        artist_name: meta.artist_name, album_name: meta.album_name,
        album_artist: meta.album_artist, track_number: meta.track_number,
        disc_number: meta.disc_number, duration: meta.duration,
        bitrate: meta.bitrate, sample_rate: meta.sample_rate,
        genre: meta.genre, year: meta.year, file_size: meta.file_size,
        file_extension: meta.file_extension, last_modified: meta.last_modified,
        added_at: Date.now(),
        mbz_recording_id: meta.mbz_recording_id,
        mbz_track_id: meta.mbz_track_id,
        mbz_album_id: meta.mbz_album_id,
        mbz_release_group_id: meta.mbz_release_group_id,
        mbz_artist_id: meta.mbz_artist_id,
      };

      await batchInsertSongs([song]);

      scannedCount++;
      setState({ progress: { done: scannedCount, currentItem: filePath } });
    } catch (err) {
      console.warn(`[indexer] error processing file ${filePath}:`, err);
    }
  }

  async function enrichArtistsFromMusicBrainz() {
    if (uniqueArtists.size === 0) return;

    // Dynamically import MusicBrainz client only when needed
    const { getArtistDetail, searchArtists } = await import(
      "../../services/musicbrainz-client"
    );

    let enriched = 0;
    for (const [, entry] of uniqueArtists) {
      if (aborted) break;

      // Skip if already in DB and up-to-date
      const existing = entry.mbid
        ? await getArtistByMbid(entry.mbid)
        : await getArtistByName(entry.name);
      if (existing) continue;

      let mbid = entry.mbid;
      let artistData = null;

      if (mbid) {
        publishStatus(`Fetching artist info for ${entry.name}…`, "info", "MusicBrainz");
        artistData = await getArtistDetail(mbid);
      }

      // If no MBID or lookup failed, fall back to searching by name
      if (!artistData) {
        publishStatus(`Searching MusicBrainz for ${entry.name}…`, "info", "MusicBrainz");
        try {
          const searchRes = await searchArtists(entry.name, { limit: 1 });
          if (searchRes.artists && searchRes.artists.length > 0) {
            artistData = searchRes.artists[0];
            mbid = artistData.id;
            // Also fetch full detail to get extra fields
            const full = await getArtistDetail(mbid);
            if (full) artistData = full;
          }
        } catch {
          // Search failed – skip enrichment for this artist
        }
      }

      if (artistData) {
        const genres = artistData.tags
          ? JSON.stringify(artistData.tags.map((t: any) => t.name))
          : null;

        await upsertArtist({
          id: mbid || `local-artist-${entry.name.toLowerCase().replace(/\s+/g, "-")}`,
          name: entry.name,
          mbz_artist_id: mbid || null,
          biography: null,
          image_url: null,
          genres,
          country: artistData.country || null,
          type: artistData.type || null,
          disambiguation: artistData.disambiguation || null,
        });
        enriched++;
      }
    }

    if (enriched > 0) {
      publishStatus(`Artist metadata updated for ${enriched} artist${enriched > 1 ? "s" : ""}`, "success", "MusicBrainz");
    }
  }

  async function finish() {
    // Enrich artist info from MusicBrainz before finishing
    await enrichArtistsFromMusicBrainz();

    const count = await getSongCount();
    scannedCount = count;
    await updateScanState({
      scan_status: "done", total_files: count, scanned_files: count,
      current_dir: "", last_scanned_at: Date.now(), watcher_enabled: 1,
    });
    setState({ status: "done", progress: { total: count, done: count, currentItem: "" } });
    publishStatus(`Local library indexed: ${count} song${count !== 1 ? "s" : ""}`, "success");
    scheduleWatch();
  }

  // ── Watcher ──

  function scheduleWatch() {
    watchTimer = setTimeout(checkChanges, WATCH_INTERVAL);
  }

  async function checkChanges() {
    const state = await getScanState();
    if (!state || state.scan_status !== "done" || !state.watcher_enabled) {
      scheduleWatch();
      return;
    }

    try {
      const p = await getPlatform();
      const dbPaths = new Set(await getAllPaths());
      const fsPaths = new Set<string>();
      const root = state.root_folder;
      if (!root) { scheduleWatch(); return; }

      const pending = [root];
      const visited = new Set<string>();
      const newFiles: string[] = [];

      while (pending.length > 0) {
        const dir = pending.shift()!;
        if (visited.has(dir)) continue;
        visited.add(dir);
        if (visited.size > 200) break;

        let entries: DirEntry[];
        try { entries = await p.readDirectory(dir); } catch { continue; }
        for (const e of entries) {
          if (!e.name) continue;
          if (e.isDirectory) { pending.push(e.path); continue; }
          const ext = getAudioExt(e.name);
          if (!AUDIO_EXTENSIONS.has(ext)) continue;
          fsPaths.add(e.path);
          if (!dbPaths.has(e.path)) newFiles.push(e.path);
        }
      }

      let changed = newFiles.length > 0;
      for (const dbPath of dbPaths) {
        if (!fsPaths.has(dbPath)) { await deleteSong(fileIdFromPath(dbPath)); changed = true; }
      }

      if (newFiles.length > 0) {
        setState({ status: "indexing" });
        await updateScanState({ scan_status: "indexing" });
        await enqueueScan(newFiles.map((p) => ({ type: "file", path: p })));
        paused = false; aborted = false;
        run();
      } else if (changed) {
        const count = await getSongCount();
        setState({ progress: { total: count, done: scannedCount } });
      }
    } catch (err) {
      console.warn("[watcher] error:", err);
    }
    scheduleWatch();
  }

  return { start, pause, resume, abort, getStatus, onProgress, startWatcher };
}
