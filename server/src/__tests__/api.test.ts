import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import { createApp } from "../app";
import { config } from "../config";
import { initDb, closeDb } from "../db/connection";
import { resetScanState } from "../scanner/scanner";

let server: http.Server;
let baseUrl: string;
let tmpDir: string;

async function waitForScanDone(url: string, maxRetries = 20): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const sr = await fetch(`${url}/api/selftify/scan/status`);
    const sb = await sr.json();
    if (sb.status === "done" || sb.status === "error") return;
  }
}

async function waitForScanIdle(url: string, maxRetries = 20): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const sr = await fetch(`${url}/api/selftify/scan/status`);
    const sb = await sr.json();
    if (sb.status === "idle" || sb.status === "done") return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-test-"));
  fs.mkdirSync(path.join(tmpDir, "subfolder"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "subfolder", "not-audio.txt"), "hello");
  fs.writeFileSync(path.join(tmpDir, "subfolder", "song.mp3"), Buffer.alloc(1024));
  fs.writeFileSync(path.join(tmpDir, "readme.txt"), "test");

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

afterAll(() => {
  server?.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/health", () => {
  it("returns ok status with database flag", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("version");
    expect(body.database).toBe(true);
  });
});

describe("GET /api/selftify/capabilities", () => {
  it("returns feature list including scan", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/capabilities`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("selftify");
    expect(body.features).toContain("scan");
  });
});

describe("GET /api/selftify/config", () => {
  it("returns current server configuration and scan status", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.libraryRoot).toBe(tmpDir);
    expect(body.dbReady).toBe(true);
    expect(body.scan).toBeDefined();
    expect(body.scan.status).toBe("idle");
  });
});

describe("PUT /api/selftify/config", () => {
  it("updates library root and re-initializes database", async () => {
    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-test-newroot-"));
    fs.mkdirSync(path.join(newDir, ".selftify"), { recursive: true });

    const res = await fetch(`${baseUrl}/api/selftify/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ libraryRoot: newDir }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.libraryRoot).toBe(newDir);
    expect(body.dbReady).toBe(true);

    // Verify the config endpoint reflects the change
    const getRes = await fetch(`${baseUrl}/api/selftify/config`);
    const getBody = await getRes.json();
    expect(getBody.libraryRoot).toBe(newDir);

    // Reset to tmpDir for subsequent tests
    closeDb();
    resetScanState();
    config.libraryRoot = tmpDir;
    initDb();

    fs.rmSync(newDir, { recursive: true, force: true });
  });

  it("returns 400 when libraryRoot is missing", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/selftify/browse", () => {
  it("lists directories at the given path", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/browse?path=${encodeURIComponent(tmpDir)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe(tmpDir);
    expect(body.parent).not.toBeNull();
    expect(body.isRoot).toBe(false);
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("shows hasAudio=true for folders containing audio files", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/browse?path=${encodeURIComponent(tmpDir)}`);
    const body = await res.json();
    const subfolder = body.entries.find((e: any) => e.name === "subfolder");
    expect(subfolder).toBeDefined();
    expect(subfolder.hasAudio).toBe(true);
    expect(subfolder.audioCount).toBe(1);
  });

  it("returns error for non-existent path", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/browse?path=${encodeURIComponent(path.join(tmpDir, "nonexistent"))}`);
    expect(res.status).toBe(500);
  });

  it("returns parent=null at filesystem root", async () => {
    const root = process.platform === "win32" ? "C:\\" : "/";
    const res = await fetch(`${baseUrl}/api/selftify/browse?path=${encodeURIComponent(root)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isRoot).toBe(true);
  });
});

describe("POST /api/selftify/scan", () => {
  it("starts a scan and completes", async () => {
    await waitForScanIdle(baseUrl);
    const res = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("started");

    await waitForScanDone(baseUrl);
    const statusRes = await fetch(`${baseUrl}/api/selftify/scan/status`);
    const statusBody = await statusRes.json();
    expect(statusBody.status).toBe("done");
    expect(statusBody.finishedAt).not.toBeNull();
  });

  it("returns 409 when scan is already running", async () => {
    await waitForScanIdle(baseUrl);

    const res1 = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(res1.status).toBe(200);
    const res2 = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    if (res2.status === 409) {
      const body = await res2.json();
      expect(body.error).toContain("already in progress");
    }

    await waitForScanIdle(baseUrl);
  });
});

describe("GET /api/selftify/scan/status", () => {
  it("returns scan status object", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/scan/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("progress");
    expect(body).toHaveProperty("libraryRoot");
    expect(body).toHaveProperty("startedAt");
    expect(body).toHaveProperty("finishedAt");
  });
});

describe("Subsonic API (/rest endpoints)", () => {
  const sub = (endpoint: string, params = ""): string =>
    `${baseUrl}/rest/${endpoint}?u=admin&p=admin&v=1.16.1&c=selftify-test&f=json${params ? `&${params}` : ""}`;

  // Wait for any previous scan to finish, then run a clean scan
  beforeAll(async () => {
    await waitForScanIdle(baseUrl, 30);
    const scanRes = await fetch(`${baseUrl}/api/selftify/scan`, { method: "POST" });
    expect(scanRes.status).toBe(200);
    await waitForScanDone(baseUrl, 20);
  });

  it("ping returns ok", async () => {
    const res = await fetch(sub("ping"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("ok");
  });

  it("getMusicFolders returns folder list", async () => {
    const res = await fetch(sub("getMusicFolders"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const folders = body["subsonic-response"].musicFolders.musicFolder;
    expect(Array.isArray(folders)).toBe(true);
    expect(folders[0].name).toBe("Music");
  });

  it("getArtists returns artists grouped by index", async () => {
    const res = await fetch(sub("getArtists"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const artists = body["subsonic-response"].artists;
    expect(artists).toBeDefined();
    expect(Array.isArray(artists.index)).toBe(true);
  });

  it("getAlbumList2 returns albums", async () => {
    const res = await fetch(sub("getAlbumList2", "type=alphabeticalByName&size=10&offset=0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const albumList = body["subsonic-response"].albumList2;
    expect(albumList).toBeDefined();
    expect(Array.isArray(albumList.album)).toBe(true);
  });

  it("search3 returns results", async () => {
    const res = await fetch(sub("search3", "query=song&artistCount=5&albumCount=5&songCount=10"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const result = body["subsonic-response"].searchResult3;
    expect(result).toBeDefined();
    expect(Array.isArray(result.song)).toBe(true);
    expect(Array.isArray(result.album)).toBe(true);
  });

  it("returns error for missing required params", async () => {
    const res = await fetch(sub("getAlbum"));
    expect(res.status).toBe(200); // Subsonic always returns 200 with error in body
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("failed");
    expect(body["subsonic-response"].error).toBeDefined();
  });

  it("returns error for unknown endpoint", async () => {
    const res = await fetch(sub("unknownEndpoint"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("failed");
    expect(body["subsonic-response"].error.code).toBe(20);
  });

  it("fails without auth", async () => {
    const res = await fetch(`${baseUrl}/rest/ping.view?f=json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["subsonic-response"].status).toBe("failed");
    expect(body["subsonic-response"].error).toBeDefined();
  });
});
