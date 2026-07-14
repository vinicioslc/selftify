import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import { createApp } from "../app";
import { config } from "../config";
import { initDb, closeDb } from "../db/connection";
import { resetScanState } from "../scanner/scanner";
import * as downloadQueue from "../services/download-queue";

let server: http.Server;
let baseUrl: string;
let tmpDir: string;
let dbDir: string;

const SAMPLE_SONG = {
  id: "sse-test-song-1",
  name: "SSE Test Song",
  artistName: "SSE Test Artist",
  albumName: "SSE Test Album",
  trackNumber: 1,
  duration: 240,
  releaseYear: 2024,
  imageUrl: null,
};

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-sse-db-"));
  process.env.SELFTIFY_DB_PATH = path.join(dbDir, "test.db");

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-sse-"));

  closeDb();
  resetScanState();
  config.libraryRoot = tmpDir;
  initDb();
  downloadQueue._setProcessOnEnqueue(false);

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
  if (dbDir) { try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* */ } }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ } }
});

describe("SSE download events endpoint", () => {
  it("should accept SSE connection and return correct headers", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/download/events`);
    // SSE endpoint should be accessible
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("connection")).toContain("keep-alive");
  });

  it("should emit task-created event when a task is enqueued", async () => {
    // Open SSE connection
    const controller = new AbortController();
    const events: string[] = [];
    const ssePromise = (async () => {
      const res = await fetch(`${baseUrl}/api/selftify/download/events`, {
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        events.push(text);
      }
    })();

    // Wait a moment for connection to establish
    await new Promise((r) => setTimeout(r, 100));

    // Enqueue a task
    await fetch(`${baseUrl}/api/selftify/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: SAMPLE_SONG }),
    });

    // Wait for SSE event
    await new Promise((r) => setTimeout(r, 300));

    // Close SSE
    controller.abort();
    await ssePromise.catch(() => {});

    // Check that we received at least one event
    expect(events.length).toBeGreaterThan(0);
    const allText = events.join("");
    expect(allText).toContain("event: task-created");
    expect(allText).toContain("SSE Test Song");
  });

  it("should receive separate events for different tasks", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    const ssePromise = (async () => {
      const res = await fetch(`${baseUrl}/api/selftify/download/events`, {
        signal: controller.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        events.push(text);
      }
    })();

    await new Promise((r) => setTimeout(r, 100));

    // Enqueue two different tasks
    await fetch(`${baseUrl}/api/selftify/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: { ...SAMPLE_SONG, id: "sse-test-2", name: "Song 2" } }),
    });
    await fetch(`${baseUrl}/api/selftify/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: { ...SAMPLE_SONG, id: "sse-test-3", name: "Song 3" } }),
    });

    await new Promise((r) => setTimeout(r, 300));

    controller.abort();
    await ssePromise.catch(() => {});

    const allText = events.join("");
    const taskCreatedCount = (allText.match(/event: task-created/g) || []).length;
    expect(taskCreatedCount).toBeGreaterThanOrEqual(2);
    expect(allText).toContain("Song 2");
    expect(allText).toContain("Song 3");
  });
});