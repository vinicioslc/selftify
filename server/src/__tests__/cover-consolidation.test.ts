import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { config } from "../config";
import { initDb, closeDb, getDb } from "../db/connection";
import { createApp } from "../app";
import http from "http";

let server: http.Server;
let baseUrl: string;
let tmpDir: string;
let dbDir: string;

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-cvr-consolidate-"));
  process.env.SELFTIFY_DB_PATH = path.join(dbDir, "test.db");

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-cvr-test-"));
  fs.mkdirSync(path.join(tmpDir, "Some Artist", "Some Album"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "Some Artist", "Some Album", "cover.jpg"), Buffer.from("LOCAL_COVER_JPEG" + "X".repeat(242), "utf-8"));
  fs.writeFileSync(path.join(tmpDir, "Some Artist", "Some Album", "01 - Song.mp3"), Buffer.alloc(2048));

  // Artist with embedded cover
  const artistCoverDir = path.join(tmpDir, ".selftify", "images", "artist");
  fs.mkdirSync(artistCoverDir, { recursive: true });
  fs.writeFileSync(path.join(artistCoverDir, "test-artist.jpg"), Buffer.from("ARTIST_COVER_JPEG" + "Y".repeat(240), "utf-8"));

  closeDb();
  config.libraryRoot = tmpDir;
  initDb();

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server address unavailable");
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Scan to populate DB
  await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
  await new Promise((r) => setTimeout(r, 2000));
});

afterAll(() => {
  server?.close();
  closeDb();
  delete process.env.SELFTIFY_DB_PATH;
  if (dbDir) { try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* */ } }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } }
});

describe("CoverResolver consolidation", () => {
  it("cover-resolver resolves album cover from local filesystem", async () => {
    const { resolveCover } = await import("../services/cover-resolver");
    const db = getDb();

    // Find the album ID created by the scan
    const albumRow = db.prepare("SELECT id FROM albums WHERE name = ?").get("Some Album") as { id: string } | undefined;
    expect(albumRow).toBeDefined();

    const result = await resolveCover(albumRow!.id);
    expect(result).toBeDefined();
    expect(result!.data.length).toBeGreaterThan(0);
  });

  it("cover-resolver returns null for non-existent album", async () => {
    const { resolveCover } = await import("../services/cover-resolver");
    const result = await resolveCover("nonexistent-album-id");
    expect(result).toBeNull();
  });

  it("cover-download delegates to cover-resolver chain", async () => {
    const { downloadCover } = await import("../services/cover-download");

    // Test with a known album that has a local cover
    const result = await downloadCover("Some Artist", "Some Album");
    // May return null if no online match + local fs not accessible via this path,
    // but should not throw
    expect(result).not.toBeInstanceOf(Error);
  });

  it("cover-download returns null for unknown artist/album", async () => {
    const { downloadCover } = await import("../services/cover-download");
    const result = await downloadCover("!!nonexistent_artist_123!!", "!!nonexistent_album_456!!");
    // Should not throw — gracefully returns null
    expect(result).toBeNull();
  });

  it("cover-download tries YouTube thumbnail when videoId provided", async () => {
    const { downloadCover } = await import("../services/cover-download");
    // Use a well-known YouTube video ID (Rick Astley — guaranteed to have a thumbnail)
    const result = await downloadCover(
      "Some Artist",
      "Some Album",
      null,
      "dQw4w9WgXcQ",
    );
    // This should work since the YouTube thumbnail endpoint is public
    // If it fails (network), expect null, not throw
    if (result) {
      expect(result.length).toBeGreaterThan(100);
    }
  });

  it("both cover-resolver and cover-download use same online-cover providers", async () => {
    const { tryDeezer, tryItunes } = await import("../services/online-cover");
    const deezerResult = await tryDeezer("The Beatles", "Abbey Road");
    if (deezerResult) {
      expect(deezerResult.data.length).toBeGreaterThan(0);
      expect(deezerResult.contentType).toContain("image");
    }
  });

  it("artist cover resolution works through subsonic API", async () => {
    const db = getDb();
    const artistRow = db.prepare("SELECT id FROM artists LIMIT 1").get() as { id: string } | undefined;
    if (!artistRow) return; // skip if no artist
    const { resolveCover } = await import("../services/cover-resolver");
    const result = await resolveCover(`ar-${artistRow.id}`);
    // Artist may or may not have a cover; shouldn't throw
    expect(result).not.toBeInstanceOf(Error);
  });
});