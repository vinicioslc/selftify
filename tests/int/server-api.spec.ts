import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";

// Direct imports (tsx handles TS at runtime)
const { createApp } = await import("../../server/src/app.js");
const { config } = await import("../../server/src/config.js");
const { initDb, closeDb } = await import("../../server/src/db/connection.js");
const { resetScanState } = await import("../../server/src/scanner/scanner.js");

let server: http.Server;
let baseUrl: string;
let tmpDir: string;

async function waitForScanDone(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(`${baseUrl}/api/selftify/scan/status`);
    const body = await res.json();
    if (body.status === "done" || body.status === "error") return body;
  }
  throw new Error("Scan did not complete in time");
}

test.describe("Selftify Server API Integration", () => {
  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-int-"));
    const musicDir = path.join(tmpDir, "TestArtist", "TestAlbum (2024)");
    const altDir = path.join(tmpDir, "AnotherArtist", "AnotherAlbum");
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(altDir, { recursive: true });

    // Write minimal fake MP3s
    const minMp3 = Buffer.from([
      0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    fs.writeFileSync(path.join(musicDir, "01 Track One.mp3"), minMp3);
    fs.writeFileSync(path.join(musicDir, "02 Track Two.mp3"), minMp3);
    fs.writeFileSync(path.join(altDir, "01 Another Song.mp3"), minMp3);
    fs.writeFileSync(path.join(tmpDir, "not-audio.txt"), "hello");

    // Init server
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
  });

  test.afterAll(() => {
    server?.close();
    closeDb();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("health returns ok", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe(true);
  });

  test("capabilities includes scan", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/capabilities`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.features).toContain("scan");
  });

  test("config shows library root and db ready", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.libraryRoot).toBe(tmpDir);
    expect(body.dbReady).toBe(true);
  });

  test("full scan → songs visible via Subsonic API", async () => {
    const scanRes = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(scanRes.status).toBe(200);

    const finalStatus = await waitForScanDone();
    expect(finalStatus.status).toBe("done");

    // search3 with empty query returns all songs
    const searchRes = await fetch(
      `${baseUrl}/rest/search3.view?query=&artistCount=0&albumCount=0&songCount=100&u=admin&p=admin&v=1.16.1&c=selftify-int&f=json`,
    );
    expect(searchRes.status).toBe(200);
    const searchBody = await searchRes.json();
    const songs = searchBody["subsonic-response"]?.searchResult3?.song || [];
    expect(songs.length).toBe(3);
    expect(songs.map((s: any) => s.title).sort()).toEqual([
      "01 Another Song",
      "01 Track One",
      "02 Track Two",
    ]);
    expect(songs[0].artist).toBeDefined();
    expect(songs[0].album).toBeDefined();

    // getAlbumList2 returns albums
    const albumRes = await fetch(
      `${baseUrl}/rest/getAlbumList2.view?type=alphabeticalByName&size=100&offset=0&u=admin&p=admin&v=1.16.1&c=selftify-int&f=json`,
    );
    expect(albumRes.status).toBe(200);
    const albumBody = await albumRes.json();
    const albums = albumBody["subsonic-response"]?.albumList2?.album || [];
    expect(albums.length).toBe(2);
    const albumNames = albums.map((a: any) => a.name).sort();
    expect(albumNames).toContain("TestAlbum (2024)");
    expect(albumNames).toContain("AnotherAlbum");

    // getArtists returns artists
    const artistRes = await fetch(
      `${baseUrl}/rest/getArtists.view?u=admin&p=admin&v=1.16.1&c=selftify-int&f=json`,
    );
    expect(artistRes.status).toBe(200);
    const artistBody = await artistRes.json();
    const indexes = artistBody["subsonic-response"]?.artists?.index || [];
    const allArtists = indexes.flatMap((ix: any) => ix.artist || []);
    const artistNames = allArtists.map((a: any) => a.name).sort();
    expect(artistNames).toContain("TestArtist");
    expect(artistNames).toContain("AnotherArtist");

    // getAlbum returns songs for a specific album
    const albumId = albums[0].id;
    const detailRes = await fetch(
      `${baseUrl}/rest/getAlbum.view?id=${albumId}&u=admin&p=admin&v=1.16.1&c=selftify-int&f=json`,
    );
    expect(detailRes.status).toBe(200);
    const detailBody = await detailRes.json();
    const albumSongs = detailBody["subsonic-response"]?.album?.song || [];
    expect(albumSongs.length).toBeGreaterThan(0);

    // Stream endpoint returns audio
    const songId = songs[0].id;
    const streamRes = await fetch(
      `${baseUrl}/rest/stream.view?id=${songId}&u=admin&p=admin&v=1.16.1&c=selftify-int`,
    );
    expect(streamRes.status).toBe(200);
    const contentType = streamRes.headers.get("content-type") || "";
    expect(contentType).toContain("audio");
  });

  test("scan returns 409 when already running", async () => {
    const r1 = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(r1.status).toBe(200);
    const r2 = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(r2.status).toBe(409);
    await waitForScanDone();
  });

  test("settings endpoints work", async () => {
    // GET returns empty initially
    const get1 = await fetch(`${baseUrl}/api/settings`);
    expect(get1.status).toBe(200);
    const body1 = await get1.json();
    expect(body1).toHaveProperty("settings");

    // PUT a setting
    const put = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { theme: "light", crossfadeEnabled: true } }),
    });
    expect(put.status).toBe(200);
    const body2 = await put.json();
    expect(body2.settings.theme).toBe("light");
    expect(body2.settings.crossfadeEnabled).toBe(true);

    // GET returns persisted settings
    const get2 = await fetch(`${baseUrl}/api/settings`);
    expect(get2.status).toBe(200);
    const body3 = await get2.json();
    expect(body3.settings.theme).toBe("light");
    expect(body3.settings.crossfadeEnabled).toBe(true);
  });

  test("browse lists directories with audio counts", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/browse?path=${encodeURIComponent(tmpDir)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe(tmpDir);
    const entryNames = body.entries.map((e: any) => e.name).sort();
    expect(entryNames).toContain("TestArtist");
    expect(entryNames).toContain("AnotherArtist");

    const artistEntry = body.entries.find((e: any) => e.name === "TestArtist");
    expect(artistEntry.hasAudio).toBe(false); // artist dir has subdirs, not directly
    expect(artistEntry.audioCount).toBe(0);

    // Browse into TestArtist
    const subRes = await fetch(
      `${baseUrl}/api/selftify/browse?path=${encodeURIComponent(path.join(tmpDir, "TestArtist"))}`,
    );
    expect(subRes.status).toBe(200);
    const subBody = await subRes.json();
    expect(subBody.entries.length).toBe(1);
    expect(subBody.entries[0].name).toBe("TestAlbum (2024)");
    expect(subBody.entries[0].hasAudio).toBe(true);
    expect(subBody.entries[0].audioCount).toBe(2);
  });
});
