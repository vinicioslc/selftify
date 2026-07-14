import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import { createApp } from "../app";
import { config } from "../config";
import { initDb, closeDb, getDb, isDbReady } from "../db/connection";
import { resetScanState } from "../scanner/scanner";
import * as downloadQueue from "../services/download-queue";

let server: http.Server;
let baseUrl: string;
let tmpDir: string;
let dbDir: string;

const SAMPLE_SONG = {
  id: "song-test-1",
  name: "Test Song",
  artistName: "Test Artist",
  albumName: "Test Album",
  albumArtistName: "Test Artist",
  trackNumber: 1,
  discNumber: 1,
  duration: 240,
  genres: ["Rock"],
  releaseYear: 2024,
  imageUrl: null,
  mbzRecordingId: "rec-001",
  mbzArtistId: "art-001",
  mbzReleaseGroupId: "rg-001",
  mbzAlbumId: "alb-001",
  youtubeVideoId: "dQw4w9WgXcQ",
};

function simulateRestart(): void {
  closeDb();
  resetScanState();
  initDb();
}

beforeAll(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-dlq-db-"));
  process.env.SELFTIFY_DB_PATH = path.join(dbDir, "test.db");

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-dlq-"));

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
  delete process.env.SELFTIFY_DB_PATH;
  if (dbDir) {
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

beforeEach(() => {
  // Prevent auto-processing so tasks stay in pending state for inspection
  downloadQueue._setProcessOnEnqueue(false);
  // Clear all tasks from DB before each test
  const db = getDb();
  db.prepare("DELETE FROM download_tasks").run();
});

describe("Download Repository CRUD", () => {
  it("should create a task in the database", async () => {
    const task = downloadQueue.enqueueTask(SAMPLE_SONG);
    expect(task).toBeDefined();
    expect(task.id).toBeTruthy();
    expect(task.status).toBe("pending");
    expect(task.song.id).toBe("song-test-1");

    // Verify it's actually in the DB
    const db = getDb();
    const row = db.prepare("SELECT * FROM download_tasks WHERE id = ?").get(task.id) as any;
    expect(row).toBeDefined();
    expect(row.status).toBe("pending");
  });

  it("should retrieve a task after creation", async () => {
    const created = downloadQueue.enqueueTask(SAMPLE_SONG);
    const retrieved = downloadQueue.getTask(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.song.name).toBe("Test Song");
  });

  it("should list all tasks sorted by createdAt descending", async () => {
    const t1 = downloadQueue.enqueueTask({ ...SAMPLE_SONG, id: "song-sort-1" });
    await new Promise((r) => setTimeout(r, 10));
    const t2 = downloadQueue.enqueueTask({ ...SAMPLE_SONG, id: "song-sort-2" });

    const all = downloadQueue.getTasks();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Most recent first
    expect(all[0].id).toBe(t2.id);
    expect(all[1].id).toBe(t1.id);
  });

  it("should cancel a pending task and update the DB", async () => {
    const task = downloadQueue.enqueueTask(SAMPLE_SONG);
    const ok = downloadQueue.cancelTask(task.id);
    expect(ok).toBe(true);

    const updated = downloadQueue.getTask(task.id);
    expect(updated!.status).toBe("cancelled");
    expect(updated!.stepLabel).toBe("Cancelled");

    // Verify DB was updated
    const db = getDb();
    const row = db.prepare("SELECT status FROM download_tasks WHERE id = ?").get(task.id) as any;
    expect(row.status).toBe("cancelled");
  });

  it("should retry a failed task", async () => {
    const task = downloadQueue.enqueueTask(SAMPLE_SONG);
    // Manually set to failed (simulating what executeTask does on error)
    const db = getDb();
    db.prepare("UPDATE download_tasks SET status = 'failed', error = 'test error' WHERE id = ?").run(task.id);

    // Re-read from queue
    expect(downloadQueue.getTask(task.id)?.status).toBe("failed");
    const ok = downloadQueue.retryTask(task.id);
    expect(ok).toBe(true);

    const updated = downloadQueue.getTask(task.id);
    expect(updated!.status).toBe("pending");
    expect(updated!.error).toBeUndefined();
  });

  it("should clear completed and cancelled tasks", async () => {
    const t1 = downloadQueue.enqueueTask({ ...SAMPLE_SONG, id: "song-clear-1" });
    const t2 = downloadQueue.enqueueTask({ ...SAMPLE_SONG, id: "song-clear-2" });
    const t3 = downloadQueue.enqueueTask({ ...SAMPLE_SONG, id: "song-clear-3" });

    // Set t1 to completed, t2 to cancelled
    const db = getDb();
    db.prepare("UPDATE download_tasks SET status = 'completed', completed_at = ? WHERE id = ?").run(Date.now(), t1.id);
    db.prepare("UPDATE download_tasks SET status = 'cancelled' WHERE id = ?").run(t2.id);

    // Re-read so queue knows the updated statuses
    downloadQueue.clearCompleted();

    const remaining = downloadQueue.getTasks();
    expect(remaining.find((t) => t.id === t1.id)).toBeUndefined();
    expect(remaining.find((t) => t.id === t2.id)).toBeUndefined();
    expect(remaining.find((t) => t.id === t3.id)).toBeDefined();
  });

  it("should not enqueue duplicate of the same song", async () => {
    const t1 = downloadQueue.enqueueTask(SAMPLE_SONG);
    const t2 = downloadQueue.enqueueTask(SAMPLE_SONG);
    expect(t2.id).toBe(t1.id);
  });

  it("should allow re-enqueue after previous is cancelled", async () => {
    const t1 = downloadQueue.enqueueTask(SAMPLE_SONG);
    downloadQueue.cancelTask(t1.id);
    const t2 = downloadQueue.enqueueTask(SAMPLE_SONG);
    expect(t2.id).not.toBe(t1.id);
  });
});

describe("Persistence across restart", () => {
  it("should preserve tasks after shutdown and DB re-init", async () => {
    const task = downloadQueue.enqueueTask(SAMPLE_SONG);

    // Simulate restart
    simulateRestart();

    // Tasks should still exist in DB
    const all = downloadQueue.getTasks();
    const found = all.find((t) => t.id === task.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("pending");
    expect(found!.song.name).toBe("Test Song");
  });

  it("should reload pending tasks as available for processing", async () => {
    const task = downloadQueue.enqueueTask(SAMPLE_SONG);

    simulateRestart();

    // The queue should see this as a pending task
    const all = downloadQueue.getTasks();
    const found = all.find((t) => t.id === task.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("pending");

    // Pending tasks should be available for processing
    // The queue should pick it up via processNext()
  });

  it("should preserve task status transitions across restart", async () => {
    const task = downloadQueue.enqueueTask(SAMPLE_SONG);

    // Manually update status in DB to simulate a partial download
    const db = getDb();
    db.prepare(
      `UPDATE download_tasks SET status = 'downloading-audio', progress = 25, step_label = 'Downloading audio...', video_id = 'dQw4w9WgXcQ' WHERE id = ?`,
    ).run(task.id);

    simulateRestart();

    const found = downloadQueue.getTask(task.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("downloading-audio");
    expect(found!.progress).toBe(25);
    expect(found!.videoId).toBe("dQw4w9WgXcQ");
  });

  it("should preserve completed tasks with timestamps across restart", async () => {
    const task = downloadQueue.enqueueTask(SAMPLE_SONG);
    const ts = Date.now();

    const db = getDb();
    db.prepare(
      `UPDATE download_tasks SET status = 'completed', progress = 100, step_label = 'Completed', completed_at = ? WHERE id = ?`,
    ).run(ts, task.id);

    simulateRestart();

    const found = downloadQueue.getTask(task.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("completed");
    expect(found!.completedAt).toBe(ts);
  });

  it("should handle multiple tasks with different statuses across restart", async () => {
    const pendingTask = downloadQueue.enqueueTask({ ...SAMPLE_SONG, id: "song-multi-pending" });
    const completedTask = downloadQueue.enqueueTask({ ...SAMPLE_SONG, id: "song-multi-completed" });
    const failedTask = downloadQueue.enqueueTask({ ...SAMPLE_SONG, id: "song-multi-failed" });

    const db = getDb();
    db.prepare("UPDATE download_tasks SET status = 'completed', completed_at = ? WHERE id = ?").run(Date.now(), completedTask.id);
    db.prepare("UPDATE download_tasks SET status = 'failed', error = 'some error' WHERE id = ?").run(failedTask.id);

    simulateRestart();

    const all = downloadQueue.getTasks();
    expect(all.find((t) => t.id === pendingTask.id)?.status).toBe("pending");
    expect(all.find((t) => t.id === completedTask.id)?.status).toBe("completed");
    expect(all.find((t) => t.id === failedTask.id)?.status).toBe("failed");
    expect(all.find((t) => t.id === failedTask.id)?.error).toBe("some error");
  });
});

describe("Download task API endpoints", () => {
  it("POST /api/selftify/download/enqueue returns a task", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: SAMPLE_SONG }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toBeDefined();
    expect(body.task.status).toBe("pending");
  });

  it("POST /api/selftify/download/enqueue-multiple returns tasks", async () => {
    const songs = [
      { ...SAMPLE_SONG, id: "song-api-multi-1", name: "Multi Song 1" },
      { ...SAMPLE_SONG, id: "song-api-multi-2", name: "Multi Song 2" },
    ];
    const res = await fetch(`${baseUrl}/api/selftify/download/enqueue-multiple`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songs }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(2);
  });

  it("GET /api/selftify/download/tasks lists all tasks", async () => {
    await fetch(`${baseUrl}/api/selftify/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: { ...SAMPLE_SONG, id: "song-api-list" } }),
    });

    const res = await fetch(`${baseUrl}/api/selftify/download/tasks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/selftify/download/tasks/:id returns a single task", async () => {
    const createRes = await fetch(`${baseUrl}/api/selftify/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: { ...SAMPLE_SONG, id: "song-api-single" } }),
    });
    const { task } = await createRes.json();

    const getRes = await fetch(`${baseUrl}/api/selftify/download/tasks/${task.id}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.task.id).toBe(task.id);
  });

  it("GET /api/selftify/download/tasks/:id returns 404 for unknown task", async () => {
    const res = await fetch(`${baseUrl}/api/selftify/download/tasks/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("POST /api/selftify/download/tasks/:id/cancel cancels a pending task", async () => {
    const createRes = await fetch(`${baseUrl}/api/selftify/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: { ...SAMPLE_SONG, id: "song-api-cancel" } }),
    });
    const { task } = await createRes.json();

    const cancelRes = await fetch(`${baseUrl}/api/selftify/download/tasks/${task.id}/cancel`, { method: "POST" });
    expect(cancelRes.status).toBe(200);
    const cancelBody = await cancelRes.json();
    expect(cancelBody.success).toBe(true);

    const getRes = await fetch(`${baseUrl}/api/selftify/download/tasks/${task.id}`);
    const getBody = await getRes.json();
    expect(getBody.task.status).toBe("cancelled");
  });

  it("tasks persist in API across server restart simulation", async () => {
    const createRes = await fetch(`${baseUrl}/api/selftify/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: { ...SAMPLE_SONG, id: "song-api-restart" } }),
    });
    const { task } = await createRes.json();

    // Close and reopen DB (simulates server restart)
    closeDb();
    config.libraryRoot = tmpDir;
    initDb();

    // Verify task still exists via API
    const getRes = await fetch(`${baseUrl}/api/selftify/download/tasks/${task.id}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.task.id).toBe(task.id);
    expect(body.task.status).toBe("pending");
  });

  it("DELETE /api/selftify/download/tasks/completed removes completed/cancelled tasks", async () => {
    const createRes = await fetch(`${baseUrl}/api/selftify/download/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song: { ...SAMPLE_SONG, id: "song-api-clear" } }),
    });
    const { task } = await createRes.json();

    // Mark as completed in DB
    const db = getDb();
    db.prepare("UPDATE download_tasks SET status = 'completed', completed_at = ? WHERE id = ?").run(Date.now(), task.id);

    const delRes = await fetch(`${baseUrl}/api/selftify/download/tasks/completed`, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/selftify/download/tasks/${task.id}`);
    expect(getRes.status).toBe(404);
  });
});