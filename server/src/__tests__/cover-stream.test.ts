import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import crypto from "crypto";
import { createApp } from "../app";
import { config } from "../config";
import { initDb, closeDb, getDb } from "../db/connection";
import { resetScanState } from "../scanner/scanner";

let server: http.Server;
let baseUrl: string;
let tmpDir: string;
let albumId: string;
let trackId: string;
let coverFilePath: string;

const COVER_DATA = Buffer.from("FAKEJPEG" + "X".repeat(248), "utf-8");

const sub = (endpoint: string, params = ""): string =>
  `${baseUrl}/rest/${endpoint}?u=admin&p=admin&v=1.16.1&c=selftify-test&f=json${params ? `&${params}` : ""}`;

async function waitForScanDone(maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const sr = await fetch(`${baseUrl}/api/selftify/scan/status`);
      const sb = await sr.json();
      if (sb.status === "done" || sb.status === "error") return;
    } catch { /* retry */ }
  }
}

beforeAll(async () => {
  // Isolated DB so parallel test files don't collide on the singleton
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-cvr-db-"));
  process.env.SELFTIFY_DB_PATH = path.join(dbDir, "test.db");

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-cvr-stream-"));

  // Tracks one level deep (for browse to detect audio in subdirs)
  fs.mkdirSync(path.join(tmpDir, "ArtistWithAudio"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "ArtistWithAudio", "track.mp3"), Buffer.alloc(2048));
  fs.writeFileSync(path.join(tmpDir, "ArtistWithAudio", "readme.txt"), Buffer.alloc(64));

  // Tracks two levels deep (for scanner to create album/track in DB)
  const albumDir = path.join(tmpDir, "TestArtist", "TestAlbum (2024)");
  fs.mkdirSync(albumDir, { recursive: true });
  fs.writeFileSync(path.join(albumDir, "01 - Test Song.mp3"), Buffer.alloc(2048));

  // Cover file at a relative path under libraryRoot
  const coverAbsDir = path.join(tmpDir, ".selftify", "images", "album");
  fs.mkdirSync(coverAbsDir, { recursive: true });
  coverFilePath = path.join(coverAbsDir, "test-cover.jpg");
  fs.writeFileSync(coverFilePath, COVER_DATA);

  closeDb();
  resetScanState();
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
  const scanRes = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
  expect(scanRes.status).toBe(200);
  await waitForScanDone();

  // Discover album + track IDs for the two-level-deep album (TestArtist/TestAlbum)
  const albumRes = await fetch(sub("getAlbumList2", "type=alphabeticalByName&size=10"));
  const albumData = await albumRes.json();
  const allAlbums = albumData["subsonic-response"].albumList2.album;
  const testAlbum = allAlbums.find((a: any) => a.artist === "TestArtist" && a.name === "TestAlbum (2024)");
  expect(testAlbum, "Test album should exist after scan").toBeDefined();
  albumId = testAlbum!.id;

  const detailRes = await fetch(sub("getAlbum", `id=${albumId}`));
  const detailBody = await detailRes.json();
  const album = detailBody["subsonic-response"]?.album;
  expect(album, `Album detail for ${albumId}: ${JSON.stringify(detailBody)}`).toBeDefined();
  const songs = album.song;
  expect(songs.length, `Album should have at least 1 song, got ${songs.length}`).toBeGreaterThan(0);
  trackId = songs[0].id;
});

afterAll(() => {
  server?.close();
  closeDb();
  delete process.env.SELFTIFY_DB_PATH;
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── Cover resolution ──

describe("Cover resolution via Subsonic API", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare(`UPDATE albums SET images = '[]', updated_at = ? WHERE id = ?`).run(Date.now(), albumId);
  });

  it("returns embedded cover stored as relative path (the firstLocalImage fix)", async () => {
    const db = getDb();
    const relPath = `.selftify/images/album/test-cover.jpg`;
    db.prepare(`UPDATE albums SET images = ? WHERE id = ?`).run(
      JSON.stringify([{ url: relPath, format: "image/jpeg" }]),
      albumId,
    );
    const res = await fetch(sub("getCoverArt", `id=${albumId}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(COVER_DATA)).toBe(true);
  });

  it("returns embedded cover stored as absolute path (item.path key)", async () => {
    const db = getDb();
    db.prepare(`UPDATE albums SET images = ? WHERE id = ?`).run(
      JSON.stringify([{ path: coverFilePath, format: "image/jpeg" }]),
      albumId,
    );
    const res = await fetch(sub("getCoverArt", `id=${albumId}`));
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(COVER_DATA)).toBe(true);
  });

  it("returns embedded cover stored as plain string in array", async () => {
    const db = getDb();
    db.prepare(`UPDATE albums SET images = ? WHERE id = ?`).run(
      JSON.stringify([coverFilePath]),
      albumId,
    );
    const res = await fetch(sub("getCoverArt", `id=${albumId}`));
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(COVER_DATA)).toBe(true);
  });

  it("returns error for non-existent album ID", async () => {
    const res = await fetch(sub("getCoverArt", "id=al_nonexistent000"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("failed");
    expect(body["subsonic-response"].error.code).toBe(70);
  });

  it("returns error for album with empty images and no online match", async () => {
    const res = await fetch(sub("getCoverArt", `id=${albumId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("failed");
    expect(body["subsonic-response"].error.code).toBe(70);
  });

  it("handles missing id parameter (code 10)", async () => {
    const res = await fetch(sub("getCoverArt", ""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("failed");
    expect(body["subsonic-response"].error.code).toBe(10);
  });
});

// ── Streaming ──

describe("Stream endpoint", () => {
  it("returns audio/mpeg for an existing track", async () => {
    const res = await fetch(sub("stream", `id=${trackId}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
  });

  it("returns error for missing id param (code 10)", async () => {
    const res = await fetch(sub("stream", ""));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("failed");
    expect(body["subsonic-response"].error.code).toBe(10);
  });

  it("returns error for non-existent track ID (code 70)", async () => {
    const res = await fetch(sub("stream", "id=tr_nonexistent000"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("failed");
    expect(body["subsonic-response"].error.code).toBe(70);
  });

  it("returns error when track file is missing from disk", async () => {
    const db = getDb();
    const orig = (db.prepare(`SELECT path FROM tracks WHERE id = ?`).get(trackId) as { path: string })?.path;
    db.prepare(`UPDATE tracks SET path = 'nonexistent/song.mp3' WHERE id = ?`).run(trackId);
    const res = await fetch(sub("stream", `id=${trackId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("failed");
    expect(body["subsonic-response"].error.code).toBe(70);
    db.prepare(`UPDATE tracks SET path = ? WHERE id = ?`).run(orig, trackId);
  });

  it("supports range requests (206 partial content)", async () => {
    const res = await fetch(sub("stream", `id=${trackId}`), {
      headers: { Range: "bytes=0-99" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toMatch(/^bytes 0-99\/\d+$/);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(100);
  });
});

// ── Browse ──

describe("Browse endpoint edge cases", () => {
  it("lists directories at valid path with audio count", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/browse?path=${encodeURIComponent(tmpDir)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe(tmpDir);
    const artistDir = body.entries.find((e: any) => e.name === "ArtistWithAudio");
    expect(artistDir).toBeDefined();
    expect(artistDir.hasAudio).toBe(true);
    expect(artistDir.audioCount).toBe(1);
  });

  it("returns 500 for non-existent path", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/browse?path=${encodeURIComponent(path.join(tmpDir, "ghost"))}`);
    expect(res.status).toBe(500);
  });

  it("defaults to filesystem root when no path given", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/browse`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isRoot).toBe(true);
  });
});

// ── Config + cover persistence ──

describe("Cover after library root update", () => {
  it("resolves cover relative path after library root change", async () => {
    const newRoot = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-cfg-"));
    const newCoverDir = path.join(newRoot, ".selftify", "images", "album");
    fs.mkdirSync(newCoverDir, { recursive: true });
    const newCoverData = Buffer.from("NEWROOTCOVER" + "Y".repeat(244), "utf-8");
    fs.writeFileSync(path.join(newCoverDir, "relocated-cover.jpg"), newCoverData);

    // Update library root via API
    const res = await fetch(`${baseUrl}/api/selftify/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ libraryRoot: newRoot }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).libraryRoot).toBe(newRoot);

    // Set images to new relative path that should resolve against newRoot
    const db = getDb();
    db.prepare(`UPDATE albums SET images = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify([{ url: `.selftify/images/album/relocated-cover.jpg`, format: "image/jpeg" }]),
      Date.now(),
      albumId,
    );

    const coverRes = await fetch(sub("getCoverArt", `id=${albumId}`));
    expect(coverRes.status).toBe(200);
    const body = Buffer.from(await coverRes.arrayBuffer());
    expect(body.equals(newCoverData)).toBe(true);

    // Restore original library root
    closeDb();
    resetScanState();
    config.libraryRoot = tmpDir;
    initDb();
    try { fs.rmSync(newRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
});
