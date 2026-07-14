import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import { createApp } from "../app";
import { config } from "../config";
import { initDb, closeDb, getDb } from "../db/connection";
import { resetScanState } from "../scanner/scanner";
import { getAlbumList2 } from "../db/queries";

let server: http.Server;
let baseUrl: string;
let tmpDir: string;

function createFakeMp3(dir: string, relPath: string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  // Minimal valid MP3 frame so music-metadata doesn't throw.
  const fakeFrame = Buffer.from([
    0xff, 0xfb, 0x90, 0x00, // MPEG1 Layer3, 128kbps, 44100Hz
    0x00, 0x00, 0x00, 0x00,
  ]);
  fs.writeFileSync(full, fakeFrame);
  return full;
}

async function waitForScanDone(url: string, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const sr = await fetch(`${url}/api/selftify/scan/status`);
    const sb = await sr.json();
    if (sb.status === "done" || sb.status === "error") return;
  }
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-cleanup-test-"));

  // Two artists, each with one album
  createFakeMp3(tmpDir, "ArtistA/Album1/song1.mp3");
  createFakeMp3(tmpDir, "ArtistA/Album1/song2.mp3");
  createFakeMp3(tmpDir, "ArtistB/Album2/song3.mp3");
  createFakeMp3(tmpDir, "ArtistB/Album2/song4.mp3");
  createFakeMp3(tmpDir, "ArtistC/Album3/song5.mp3");

  closeDb();
  resetScanState();
  config.libraryRoot = tmpDir;
  // Use a dedicated test DB to avoid polluting the dev DB
  process.env.SELFTIFY_DB_PATH = path.join(tmpDir, ".selftify", "test-library.db");
  initDb();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server address unavailable");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server?.close();
  closeDb();
  delete process.env.SELFTIFY_DB_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scanner cleanup on re-scan", () => {
  it("initial scan populates DB", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(res.status).toBe(200);
    await waitForScanDone(baseUrl);

    const db = getDb();
    const trackCount = (db.prepare("SELECT COUNT(*) AS c FROM tracks").get() as { c: number }).c;
    const albumCount = (db.prepare("SELECT COUNT(*) AS c FROM albums WHERE deleted_at IS NULL").get() as { c: number }).c;
    expect(trackCount).toBe(5);
    expect(albumCount).toBe(3);
  });

  it("re-scan after removing files cleans up stale albums", async () => {
    // Remove ArtistA (2 tracks) and ArtistC (1 track)
    fs.rmSync(path.join(tmpDir, "ArtistA"), { recursive: true, force: true });
    fs.rmSync(path.join(tmpDir, "ArtistC"), { recursive: true, force: true });

    // Re-scan
    const res = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(res.status).toBe(200);
    await waitForScanDone(baseUrl);

    const db = getDb();

    // Tracks for removed files are gone
    const trackCount = (db.prepare("SELECT COUNT(*) AS c FROM tracks").get() as { c: number }).c;
    expect(trackCount).toBe(2); // Only ArtistB/Album2 remains

    // Remaining album has deleted_at = NULL
    const activeAlbums = db.prepare("SELECT name FROM albums WHERE deleted_at IS NULL").all() as { name: string }[];
    expect(activeAlbums).toHaveLength(1);
    expect(activeAlbums[0].name).toBe("Album2");

    // Stale albums have deleted_at set
    const staleAlbums = db.prepare("SELECT name FROM albums WHERE deleted_at IS NOT NULL").all() as { name: string }[];
    expect(staleAlbums).toHaveLength(2);
    const staleNames = staleAlbums.map((a) => a.name).sort();
    expect(staleNames).toEqual(["Album1", "Album3"]);

    // getAlbumList2 does not return stale or duplicate albums
    const albumList = getAlbumList2("alphabeticalByName", 50, 0);
    expect(albumList).toHaveLength(1);
    expect(albumList[0].name).toBe("Album2");
  });

  it("re-scan with original files restored brings back albums", async () => {
    // Restore the removed files
    createFakeMp3(tmpDir, "ArtistA/Album1/song1.mp3");
    createFakeMp3(tmpDir, "ArtistA/Album1/song2.mp3");

    const res = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(res.status).toBe(200);
    await waitForScanDone(baseUrl);

    const db = getDb();
    const activeAlbums = db.prepare("SELECT name FROM albums WHERE deleted_at IS NULL ORDER BY name").all() as { name: string }[];
    expect(activeAlbums).toHaveLength(2);
    expect(activeAlbums[0].name).toBe("Album1");
    expect(activeAlbums[1].name).toBe("Album2");

    // No stale albums remain (all restored or cleaned)
    const staleCount = (db.prepare("SELECT COUNT(*) AS c FROM albums WHERE deleted_at IS NOT NULL").get() as { c: number }).c;
    expect(staleCount).toBe(1); // Album3 still gone

    // getAlbumList2 returns exactly 2, no duplicates
    const albumList = getAlbumList2("alphabeticalByName", 50, 0);
    expect(albumList).toHaveLength(2);
  });

  it("scan of empty directory results in no active albums", async () => {
    // Remove all audio files
    fs.rmSync(path.join(tmpDir, "ArtistA"), { recursive: true, force: true });
    fs.rmSync(path.join(tmpDir, "ArtistB"), { recursive: true, force: true });

    const res = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(res.status).toBe(200);
    await waitForScanDone(baseUrl);

    const db = getDb();
    const activeCount = (db.prepare("SELECT COUNT(*) AS c FROM albums WHERE deleted_at IS NULL").get() as { c: number }).c;
    expect(activeCount).toBe(0);

    // All albums are now stale (soft-deleted)
    const staleCount = (db.prepare("SELECT COUNT(*) AS c FROM albums WHERE deleted_at IS NOT NULL").get() as { c: number }).c;
    expect(staleCount).toBe(3);

    // getAlbumList2 returns empty
    const albumList = getAlbumList2("alphabeticalByName", 50, 0);
    expect(albumList).toHaveLength(0);
  });
});
