import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { config } from "./config";
import { initDb, closeDb, isDbReady } from "./db/connection";
import { getScanStatus, resetScanState, startScan as runScan } from "./scanner/scanner";
import subsonicRouter from "./subsonic/routes";
import { getSettings, updateSettings } from "./services/settings";
import { downloadSong, isYtDlpAvailable } from "./services/download-service";
import * as mappingRepo from "./repositories/mapping-repo";
import * as rankingRepo from "./repositories/ranking-repo";
import * as cacheRepo from "./repositories/cache-repo";

const AUDIO_EXTS = new Set([".mp3", ".flac", ".ogg", ".m4a", ".m4b", ".opus", ".wav", ".wma", ".aac"]);

export function createApp(): express.Express {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: config.corsOrigins ?? true,
      credentials: true,
    }),
  );
  app.use(morgan("dev"));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: config.serverVersion,
      database: isDbReady(),
    });
  });

  app.get("/api/selftify/capabilities", (_req, res) => {
    res.json({
      type: "selftify",
      features: [
        "youtube",
        "lyrics-lrc",
        "download",
        "ranking",
        "organizer",
        "origins",
        "search-online",
        "scan",
        "settings",
      ],
    });
  });

  // Get current server config (library root, scan status, ListenBrainz token)
  app.get("/api/selftify/config", (_req, res) => {
    const scan = getScanStatus();
    const settings = getSettings();
    res.json({
      libraryRoot: config.libraryRoot,
      listenBrainzToken: settings.listenBrainzToken,
      dbReady: isDbReady(),
      scan,
    });
  });

  // Update library root and/or ListenBrainz token
  app.put("/api/selftify/config", (req, res) => {
    const { libraryRoot, listenBrainzToken } = req.body;
    const updates: Record<string, any> = {};

    if (libraryRoot !== undefined) {
      if (typeof libraryRoot !== "string") {
        res.status(400).json({ error: "libraryRoot must be a string" });
        return;
      }
      resetScanState();
      config.libraryRoot = libraryRoot;
      updates.libraryRoot = libraryRoot;
    }

    if (listenBrainzToken !== undefined) {
      updates.listenBrainzToken = listenBrainzToken;
    }

    if (Object.keys(updates).length > 0) {
      updateSettings(updates);
    }

    res.json({
      libraryRoot: config.libraryRoot,
      listenBrainzToken: updates.listenBrainzToken ?? getSettings().listenBrainzToken,
      dbReady: isDbReady(),
    });
  });

  // Browse filesystem — list directories with audio file counts
  app.get("/api/selftify/browse", (req, res) => {
    const dirPath = (req.query.path as string) || (process.platform === "win32" ? "C:\\" : "/");
    const resolved = path.resolve(dirPath);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(resolved, { withFileTypes: true });
    } catch (err) {
      res.status(500).json({ error: `Cannot read directory: ${(err as Error).message}` });
      return;
    }
    const dirs: { name: string; path: string; hasAudio: boolean; audioCount: number }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(resolved, entry.name);
      let audioCount = 0;
      try {
        const sub = fs.readdirSync(fullPath, { withFileTypes: true });
        for (const s of sub) {
          if (!s.isDirectory() && AUDIO_EXTS.has(path.extname(s.name).toLowerCase())) {
            audioCount++;
          }
        }
      } catch { /* skip unreadable dirs */ }
      dirs.push({ name: entry.name, path: fullPath, hasAudio: audioCount > 0, audioCount });
    }
    dirs.sort((a, b) => {
      if (a.hasAudio !== b.hasAudio) return a.hasAudio ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    const parent = path.resolve(resolved, "..");
    const isRoot = process.platform === "win32"
      ? resolved.toLowerCase() === path.parse(resolved).root.toLowerCase()
      : resolved === "/";
    res.json({ path: resolved, parent: isRoot ? null : parent, isRoot, entries: dirs });
  });

  // Trigger a library scan
  app.post("/api/selftify/scan", async (_req, res) => {
    const scan = getScanStatus();
    if (scan.status === "discovering" || scan.status === "indexing") {
      res.status(409).json({ error: "Scan already in progress" });
      return;
    }
    if (!isDbReady()) {
      res.status(400).json({ error: "Database not ready. Configure a valid library root first." });
      return;
    }
    runScan(config.libraryRoot).catch((err) => console.error("[scan] error:", err));
    res.json({ status: "started" });
  });

  // Get scan progress
  app.get("/api/selftify/scan/status", (_req, res) => {
    res.json(getScanStatus());
  });

  app.get("/api/settings", (_req, res) => {
    res.json({ settings: getSettings() });
  });

  app.put("/api/settings", (req, res) => {
    const { settings } = req.body;
    if (!settings || typeof settings !== "object") {
      res.status(400).json({ error: "settings object is required" });
      return;
    }
    const updated = updateSettings(settings);
    res.json({ settings: updated });
  });

  // Dedicated online-search configuration route. The frontend's online-search
  // toggle (and its tokens/folder) live here, decoupled from /api/selftify/config.
  app.get("/api/online-search", (_req, res) => {
    const s = getSettings();
    res.json({
      enabled: s.onlineSearchEnabled ?? false,
      musicBrainzToken: s.musicBrainzToken ?? "",
      listenBrainzToken: s.listenBrainzToken ?? "",
      youtubeMusicHeaders: s.youtubeMusicHeaders ?? "",
      downloadFolder: s.downloadFolder ?? "",
    });
  });

  app.put("/api/online-search", (req, res) => {
    const partial = req.body;
    if (!partial || typeof partial !== "object") {
      res.status(400).json({ error: "online-search config object is required" });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (typeof partial.enabled === "boolean") updates.onlineSearchEnabled = partial.enabled;
    if (typeof partial.musicBrainzToken === "string") updates.musicBrainzToken = partial.musicBrainzToken;
    if (typeof partial.listenBrainzToken === "string") updates.listenBrainzToken = partial.listenBrainzToken;
    if (typeof partial.youtubeMusicHeaders === "string") updates.youtubeMusicHeaders = partial.youtubeMusicHeaders;
    if (typeof partial.downloadFolder === "string") updates.downloadFolder = partial.downloadFolder;
    const updated = updateSettings(updates);
    res.json({
      enabled: updated.onlineSearchEnabled ?? false,
      musicBrainzToken: updated.musicBrainzToken ?? "",
      listenBrainzToken: updated.listenBrainzToken ?? "",
      youtubeMusicHeaders: updated.youtubeMusicHeaders ?? "",
      downloadFolder: updated.downloadFolder ?? "",
    });
  });

  // ---- Download endpoint ----
  app.post("/api/selftify/download", async (req, res) => {
    const { videoId, searchQuery, songName, artistName, albumName, albumArtistName, trackNumber, releaseYear, genres, imageUrl, coverArtData } = req.body;

    if (!videoId || !songName || !artistName) {
      res.status(400).json({ success: false, error: "Missing required fields: videoId, songName, artistName" });
      return;
    }

    if (!isYtDlpAvailable()) {
      res.status(500).json({ success: false, error: "yt-dlp is not installed on the server" });
      return;
    }

    const result = await downloadSong({ videoId, searchQuery, songName, artistName, albumName, albumArtistName, trackNumber, releaseYear, genres, imageUrl, coverArtData });
    res.json(result);
  });

  // ---- MusicBrainz <-> YouTube mappings (state owned by backend) ----
  app.get("/api/mbz/mapping", (req, res) => {
    const id = req.query.recordingId as string;
    if (!id) {
      res.status(400).json({ error: "recordingId query param required" });
      return;
    }
    res.json({ mapping: mappingRepo.getMapping(id) });
  });

  app.put("/api/mbz/mapping", (req, res) => {
    const m = req.body;
    if (!m || typeof m.mbzRecordingId !== "string") {
      res.status(400).json({ error: "mapping.mbzRecordingId required" });
      return;
    }
    mappingRepo.upsertMapping({
      mbzRecordingId: m.mbzRecordingId,
      songName: m.songName ?? "",
      artistName: m.artistName ?? "",
      selectedVideoId: m.selectedVideoId ?? null,
      selectedType: m.selectedType ?? null,
      candidates: Array.isArray(m.candidates) ? m.candidates : [],
      createdAt: m.createdAt ?? Date.now(),
      updatedAt: m.updatedAt ?? Date.now(),
    });
    res.json({ ok: true });
  });

  app.delete("/api/mbz/mapping", (req, res) => {
    const id = req.query.recordingId as string;
    if (!id) {
      res.status(400).json({ error: "recordingId query param required" });
      return;
    }
    mappingRepo.deleteMapping(id);
    res.json({ ok: true });
  });

  app.get("/api/mbz/mapping/all", (_req, res) => {
    res.json({ mappings: mappingRepo.getAllMappings() });
  });

  app.delete("/api/mbz/mapping/all", (_req, res) => {
    mappingRepo.clearAllMappings();
    res.json({ ok: true });
  });

  // ---- Ranking log ----
  app.get("/api/ranking/log", (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json({ entries: rankingRepo.getRecentRankings(limit) });
  });

  app.post("/api/ranking/log", (req, res) => {
    const e = req.body;
    if (!e || typeof e.query !== "string" || typeof e.winnerId !== "string") {
      res.status(400).json({ error: "query and winnerId required" });
      return;
    }
    rankingRepo.recordRanking({
      query: e.query,
      winnerId: e.winnerId,
      winnerTitle: e.winnerTitle ?? "",
      winnerUploader: e.winnerUploader ?? "",
      score: Number(e.score) || 0,
      scores: typeof e.scores === "string" ? e.scores : JSON.stringify(e.scores ?? {}),
      candidates: Number(e.candidates) || 0,
    });
    res.json({ ok: true });
  });

  app.delete("/api/ranking/log", (_req, res) => {
    rankingRepo.clearRankingLog();
    res.json({ ok: true });
  });

  // ---- Search cache ----
  app.get("/api/cache/search", (req, res) => {
    const provider = req.query.provider as string;
    const query = req.query.query as string;
    if (!provider || !query) {
      res.status(400).json({ error: "provider and query required" });
      return;
    }
    res.json({ results: cacheRepo.getSearchCache(provider, query) });
  });

  app.put("/api/cache/search", (req, res) => {
    const { provider, query, results } = req.body;
    if (!provider || !query || !results) {
      res.status(400).json({ error: "provider, query and results required" });
      return;
    }
    cacheRepo.setSearchCache(provider, query, results);
    res.json({ ok: true });
  });

  app.delete("/api/cache/search", (req, res) => {
    const key = req.query.key as string;
    if (key) {
      cacheRepo.deleteSearchCache(key);
    } else {
      const provider = req.query.provider as string | undefined;
      cacheRepo.clearSearchCache(provider);
    }
    res.json({ ok: true });
  });

  app.get("/api/cache/search/all", (_req, res) => {
    res.json({ entries: cacheRepo.getAllSearchCacheEntries() });
  });

  // ---- Query cache (MusicBrainz / YouTube) ----
  app.get("/api/cache/query", (req, res) => {
    const platform = req.query.platform as cacheRepo.QueryPlatform;
    const query = req.query.query as string;
    if (!platform || !query) {
      res.status(400).json({ error: "platform and query required" });
      return;
    }
    const hash = Array.from(
      createHash("sha256").update(query).digest(),
    )
      .map((b: number) => b.toString(16).padStart(2, "0"))
      .join("");
    res.json({ result: cacheRepo.getCachedQuery(platform, hash) });
  });

  app.put("/api/cache/query", (req, res) => {
    const { platform, query, results, originId, raw } = req.body;
    if (!platform || !query || !results) {
      res.status(400).json({ error: "platform, query and results required" });
      return;
    }
    const hash = Array.from(
      createHash("sha256").update(query).digest(),
    )
      .map((b: number) => b.toString(16).padStart(2, "0"))
      .join("");
    cacheRepo.setCachedQuery(platform, hash, results, originId ?? "", raw);
    res.json({ ok: true });
  });

  app.delete("/api/cache/query", (req, res) => {
    const platform = req.query.platform as cacheRepo.QueryPlatform | undefined;
    cacheRepo.clearQueryCache(platform);
    res.json({ ok: true });
  });

  app.use("/rest", subsonicRouter);

  return app;
}

export default createApp;
