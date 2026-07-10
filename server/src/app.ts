import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import fs from "fs";
import path from "path";
import { config } from "./config";
import { initDb, closeDb, isDbReady } from "./db/connection";
import { getScanStatus, resetScanState, startScan as runScan } from "./scanner/scanner";
import subsonicRouter from "./subsonic/routes";
import { getSettings, updateSettings } from "./services/settings";

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
        "musicbrainz-oauth",
        "scan",
        "settings",
      ],
    });
  });

  // Get current server config (library root, scan status)
  app.get("/api/selftify/config", (_req, res) => {
    const scan = getScanStatus();
    res.json({
      libraryRoot: config.libraryRoot,
      dbReady: isDbReady(),
      scan,
    });
  });

  // Update library root and re-initialize database
  app.put("/api/selftify/config", (req, res) => {
    const { libraryRoot } = req.body;
    if (!libraryRoot || typeof libraryRoot !== "string") {
      res.status(400).json({ error: "libraryRoot is required" });
      return;
    }
    closeDb();
    resetScanState();
    config.libraryRoot = libraryRoot;
    try {
      initDb();
    } catch (err) {
      console.warn("[config] DB init after root change:", (err as Error).message);
    }
    res.json({ libraryRoot: config.libraryRoot, dbReady: isDbReady() });
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

  app.use("/rest", subsonicRouter);

  return app;
}

export default createApp;
