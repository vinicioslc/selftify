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
import { useStatusStore } from "../../stores/status.store";
import { clearMemoryCache } from "../../services/memory-cache";
import { storeImage as indexDbStoreImage, md5Hash } from "../../services/image-store";
import { electronStoreImage, isElectronImageStore } from "../../services/electron-image-store";
import type { PlatformService, DirEntry } from "../../services/platform/types";

/** Publish a status message to the global TopBar status store.
 *  Safe to call outside React (uses Zustand getState()). */
function publishStatus(text: string, level: "info" | "success" | "warn" | "danger" = "info", source = "Local Scan") {
  try {
    useStatusStore.getState().addMessage(text, level, source);
  } catch (err) {
    console.warn("[indexer] publishStatus error:", err);
  }
}

const DIR_BATCH = 10;
const FILE_BATCH = 5;
const WATCH_INTERVAL = 15000;

const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".wma", ".opus", ".aiff", ".alac",
]);

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".bmp",
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
  let totalDiscovered = 0;
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

    try {
      await updateScanState({
        root_folder: folder,
        scan_status: "scanning",
        total_files: 0,
        scanned_files: 0,
        current_dir: folder,
        last_scanned_at: null,
        watcher_enabled: 0,
      });
    } catch (err) {
      console.warn("[indexer] updateScanState error:", err);
    }

    publishStatus("Starting local library scan\u2026", "info");

    try {
      const existingCount = await getSongCount();

      if (existingCount > 0) {
        await incrementalScan(folder);
      } else {
        await clearQueue();
        totalDiscovered = 0;

        // Phase 1: discover — walk all directories, count audio files, enqueue everything
        setState({ status: "discovering", progress: { total: 0, done: 0, currentItem: folder } });
        publishStatus("Counting files in music folder\u2026", "info");

        totalDiscovered = await discoverAndEnqueue(folder);

        if (totalDiscovered > 0) {
          // Phase 2: indexing — extract metadata with known total
          setState({ status: "indexing", progress: { total: totalDiscovered, done: 0, currentItem: folder } });
          publishStatus(`Found ${totalDiscovered} audio file${totalDiscovered !== 1 ? "s" : ""} \u2014 extracting metadata\u2026`, "info");
          run();
        } else {
          await finish();
        }
      }
    } catch (err) {
      console.error("[indexer] start failed:", err);
      publishStatus("Scan failed to start. Check logs.", "danger");
      setState({ status: "idle" });
    }
  }

  async function incrementalScan(root: string) {
    try {
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
        try { entries = await p.readDirectory(dir); } catch (err) { console.warn("[indexer] readDirectory error:", err); continue; }

        for (const e of entries) {
          if (!e.name) continue;
          if (e.isDirectory) { if (e.name !== ".trash") pending.push(e.path); continue; }
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
    } catch (err) {
      console.error("[indexer] incrementalScan failed:", err);
      publishStatus("Incremental scan failed. Try a full rescan.", "danger");
      setState({ status: "idle" });
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

  /** Walk all directories recursively, count audio files, and enqueue everything.
   *  Returns total number of audio files found. */
  async function discoverAndEnqueue(root: string): Promise<number> {
    const p = await getPlatform();
    const pending = [root];
    const visited = new Set<string>();
    const allFileTasks: { type: "file"; path: string }[] = [];
    let count = 0;

    while (pending.length > 0) {
      if (aborted) break;
      const dir = pending.shift()!;
      if (visited.has(dir)) continue;
      visited.add(dir);

      setState({ progress: { currentItem: dir, done: count } });
      if (visited.size % 20 === 0) {
        publishStatus(`Scanning ${dir}… (${count} files found)`, "info");
      }

      let entries: DirEntry[];
      try {
        entries = await p.readDirectory(dir);
      } catch (err) {
        console.warn("[indexer] discoverAndEnqueue error:", err);
        continue;
      }

      for (const e of entries) {
        if (!e.name) continue;
        if (e.isDirectory) {
          if (e.name !== ".img" && e.name !== ".trash") pending.push(e.path);
        } else if (e.isFile) {
          const ext = getAudioExt(e.name);
          if (AUDIO_EXTENSIONS.has(ext)) {
            allFileTasks.push({ type: "file", path: e.path });
            count++;
          }
        }
      }
    }

    if (allFileTasks.length > 0) {
      await enqueueScan(allFileTasks);
    }

    if (count > 0) {
      publishStatus(`Found ${count} audio files`, "info");
    } else {
      publishStatus("No audio files found in the selected folder", "warn");
    }

    return count;
  }

  async function run() {
    if (aborted || paused || scanning) return;
    scanning = true;
    try {
      await processBatch();
    } catch (err) {
      console.warn("[indexer] batch error:", err);
    } finally {
      scanning = false;
    }

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
    let emptyDequeues = 0;

    while (dirs < DIR_BATCH) {
      if (aborted || paused) return;
      const item = await dequeueScan();
      if (!item) {
        emptyDequeues++;
        if (emptyDequeues >= 3) break;
        continue;
      }
      emptyDequeues = 0;

      if (item.type === "dir") {
        await processDir(item.path);
        dirs++;
      } else if (item.type === "file") {
        await processFile(item.path);
        files++;
      }

      if (files > 0 && files % 5 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
      if (files >= FILE_BATCH) break;
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

      let imgDirPath: string | null = null;

      for (const entry of entries) {
        if (aborted) return;
        if (!entry.name) continue;
        if (entry.isDirectory) {
          if (entry.name === ".img") {
            imgDirPath = entry.path;
          } else if (entry.name !== ".trash") {
            subdirs.push(entry.path);
          }
        } else if (entry.isFile) {
          const ext = getAudioExt(entry.name);
          if (AUDIO_EXTENSIONS.has(ext)) {
            audioFiles.push(entry.path);
          }
        }
      }

      // Process .img directory for cover art
      if (imgDirPath) {
        const scanState = await getScanState();
        const rootFolder = scanState?.root_folder || "";
        const relPath = rootFolder ? dirPath.replace(rootFolder, "").replace(/^\/+/, "") : "";
        const pathParts = relPath.split("/").filter(Boolean);
        const artistName = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : null;
        const albumName = pathParts.length >= 1 ? pathParts[pathParts.length - 1] : null;
        try {
          const imgEntries = await p.readDirectory(imgDirPath);
          for (const imgEntry of imgEntries) {
            if (!imgEntry.isFile) continue;
            const ext = getAudioExt(imgEntry.name);
            if (IMAGE_EXTENSIONS.has(ext)) {
              try {
                const imgData = await p.readFile(imgEntry.path);
                if (imgData && imgData.length > 0) {
                  const hash = await md5Hash(imgData.buffer as ArrayBuffer);
                  const record = {
                    md5: hash,
                    blob: imgData.buffer as ArrayBuffer,
                    format: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg",
                    size: imgData.length,
                    createdAt: Date.now(),
                    sourceUrl: `local://${relPath}/.img/${imgEntry.name}`,
                    artistName: artistName?.toLowerCase().trim() || undefined,
                    albumName: albumName?.toLowerCase().trim() || undefined,
                  };
                  if (await isElectronImageStore()) {
                    await electronStoreImage(record);
                  } else {
                    await indexDbStoreImage(record);
                  }
                  publishStatus(`Cached cover: ${relPath}/.img/${imgEntry.name}`, "info");
                }
              } catch (imgErr) {
                console.warn(`[indexer] error caching .img file ${imgEntry.path}:`, imgErr);
              }
            }
          }
        } catch (dirErr) {
          console.warn(`[indexer] error reading .img dir ${imgDirPath}:`, dirErr);
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
      } = undefined as any;

      // Try to parse metadata via IPC (main process) or fallback to renderer-side music-metadata
      try {
        const api = (window as any).electronApi;
        let parsed: any = null;

        if (api?.local?.parseFile) {
          parsed = await Promise.race([
            api.local.parseFile(filePath),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("electronApi.parseFile timeout")), 30000)
            ),
          ]);
          if (parsed?.error) {
            console.warn(`[indexer] parse error for ${filePath}: ${parsed.error}`);
            parsed = null;
          }
        } else {
          const mm = await import("music-metadata");
          const mmResult = await Promise.race([
            mm.parseBuffer(data, { path: filePath }, { duration: true, skipCovers: false }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("parseBuffer timeout")), 15000)
            ),
          ]);
          if (mmResult) {
            const c = mmResult.common;
            const f = mmResult.format;
            let picture: { data: number[]; format: string } | null = null;
            if (c.picture && c.picture.length > 0) {
              const pic = c.picture[0];
              picture = {
                data: Array.from(new Uint8Array(pic.data.buffer, pic.data.byteOffset, pic.data.byteLength)),
                format: pic.format || 'image/jpeg',
              };
            }
            parsed = {
              name: c.title || null, artist: c.artist || c.albumartist || null,
              album: c.album || null, albumArtist: c.albumartist || null,
              trackNumber: c.track?.no || null, discNumber: c.disk?.no || null,
              duration: f.duration ? f.duration * 1000 : null,
              bitrate: f.bitrate || null, sampleRate: f.sampleRate || null,
              genre: c.genre?.[0] || null, year: c.year || null,
              mbzRecordingId: c.musicbrainz_recordingid || null,
              mbzTrackId: c.musicbrainz_trackid || null,
              mbzAlbumId: c.musicbrainz_albumid || null,
              mbzReleaseGroupId: c.musicbrainz_releasegroupid || null,
              mbzArtistId: c.musicbrainz_artistid?.[0] || null,
              picture,
            };
          }
        }

        if (parsed) {
          meta = {
            name: parsed.name || filePath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Unknown",
            artist_name: parsed.artist || parsed.albumArtist || "Unknown Artist",
            album_name: parsed.album || null,
            album_artist: parsed.albumArtist || null,
            track_number: parsed.trackNumber || null,
            disc_number: parsed.discNumber || null,
            duration: parsed.duration || null,
            bitrate: parsed.bitrate || null,
            sample_rate: parsed.sampleRate || null,
            genre: parsed.genre || null,
            year: parsed.year || null,
            file_size: data.byteLength || data.length,
            file_extension: filePath.split(".").pop()?.toLowerCase() || "",
            last_modified: null,
            mbz_recording_id: parsed.mbzRecordingId || null,
            mbz_track_id: parsed.mbzTrackId || null,
            mbz_album_id: parsed.mbzAlbumId || null,
            mbz_release_group_id: parsed.mbzReleaseGroupId || null,
            mbz_artist_id: parsed.mbzArtistId || null,
          };

          // Store embedded cover art
          if (parsed.picture && parsed.picture.data && parsed.picture.data.length > 0) {
            try {
              const buf = new Uint8Array(parsed.picture.data).buffer;
              const hash = await md5Hash(buf);
              const artistNorm = parsed.artist?.toLowerCase().trim();
              const albumNorm = parsed.album?.toLowerCase().trim();
              const record = {
                md5: hash, blob: buf,
                format: parsed.picture.format || "image/jpeg",
                size: buf.byteLength, createdAt: Date.now(),
                sourceUrl: `local://${filePath}`,
                artistName: artistNorm || undefined,
                albumName: albumNorm || undefined,
                mbzArtistId: meta.mbz_artist_id || undefined,
                mbzReleaseGroupId: meta.mbz_release_group_id || undefined,
              };
              if (await isElectronImageStore()) {
                await electronStoreImage(record);
              } else {
                await indexDbStoreImage(record);
              }
            } catch (picErr) {
              console.error("[indexer] Failed to store embedded cover:", picErr);
            }
            if (meta.album_name) {
              publishStatus(`Indexing ${meta.artist_name} – ${meta.album_name} image…`, "info");
            }
          }

          // Track artist for MusicBrainz enrichment
          if (meta.artist_name && meta.artist_name !== "Unknown Artist") {
            const key = meta.artist_name.toLowerCase().trim();
            if (!uniqueArtists.has(key)) {
              uniqueArtists.set(key, { name: meta.artist_name, mbid: meta.mbz_artist_id || null });
            } else if (meta.mbz_artist_id) {
              const existing = uniqueArtists.get(key)!;
              if (!existing.mbid) existing.mbid = meta.mbz_artist_id;
            }
          }
        }
      } catch {
        // Parse threw — meta stays undefined, handled below
      }

      // Ensure meta is always assigned
      if (!meta) {
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

    const ARTIST_TIMEOUT = 15000;
    function mbTimeout<T>(p: Promise<T>): Promise<T> {
      return Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`MusicBrainz request timed out after ${ARTIST_TIMEOUT}ms`)), ARTIST_TIMEOUT)
        ),
      ]);
    }

    let enriched = 0;
    for (const [, entry] of uniqueArtists) {
      if (aborted) break;

      try {
        // Skip if already in DB and up-to-date
        const existing = entry.mbid
          ? await getArtistByMbid(entry.mbid)
          : await getArtistByName(entry.name);
        if (existing) continue;

        let mbid = entry.mbid;
        let artistData: any = null;

        const artistCtx = { artistName: entry.name, artistMbid: mbid ?? undefined };

        if (mbid) {
          publishStatus(`Fetching artist info for ${entry.name}…`, "info", "MusicBrainz");
          artistData = await mbTimeout(getArtistDetail(mbid, artistCtx));
        }

        // If no MBID or lookup failed, fall back to searching by name
        if (!artistData) {
          publishStatus(`Searching MusicBrainz for ${entry.name}…`, "info", "MusicBrainz");
          try {
            const searchRes: any = await mbTimeout(searchArtists(entry.name, { limit: 1 }));
            if (searchRes?.artists?.length > 0) {
              artistData = searchRes.artists[0];
              mbid = artistData.id as string;
              const full = await mbTimeout(getArtistDetail(mbid!, { ...artistCtx, artistMbid: mbid }));
              if (full) artistData = full;
            }
          } catch (err) {
            console.warn("[indexer] MusicBrainz search failed:", err);
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
      } catch (err) {
        console.warn(`[indexer] Skipping MusicBrainz enrichment for ${entry.name}:`, err);
      }
    }

    if (enriched > 0) {
      publishStatus(`Artist metadata updated for ${enriched} artist${enriched > 1 ? "s" : ""}`, "success", "MusicBrainz");
    }
  }

  async function finish() {
    try {
      // Clear stale local search cache so new results appear immediately
      clearMemoryCache("local");

      // Enrich artist info from MusicBrainz before finishing
      try {
        await enrichArtistsFromMusicBrainz();
      } catch (err) {
        console.warn("[indexer] MusicBrainz enrichment failed:", err);
      }

      const count = await getSongCount();
      scannedCount = count;
      await updateScanState({
        scan_status: "done", total_files: count, scanned_files: count,
        current_dir: "", last_scanned_at: Date.now(), watcher_enabled: 1,
      });
      setState({ status: "done", progress: { total: count, done: count, currentItem: "" } });
      publishStatus(`Local library indexed: ${count} song${count !== 1 ? "s" : ""}`, "success");
    } catch (err) {
      console.error("[indexer] finish failed:", err);
      publishStatus("Scan finished with errors. Try rescanning.", "warn");
      setState({ status: "done" });
    }
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
        try { entries = await p.readDirectory(dir); } catch (err) { console.warn("[indexer] readDirectory (watch) error:", err); continue; }
        for (const e of entries) {
          if (!e.name) continue;
          if (e.isDirectory) { if (e.name !== ".trash") pending.push(e.path); continue; }
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
