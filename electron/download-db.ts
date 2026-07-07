import Database from "better-sqlite3";
import { app } from "electron";
import { join } from "path";
import type { DownloadTask, DownloadStatus } from "../src/types/domain-types";

const SCHEMA_VERSION = 1;

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) throw new Error("Download DB not initialized");
  return db;
}

export function initDownloadDb(): void {
  const dbPath = join(app.getPath("userData"), "selftify-downloads.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations();
  resetInterruptedTasks();
}

export function closeDownloadDb(): void {
  db?.close();
  db = null;
}

function runMigrations(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      version INTEGER NOT NULL
    )
  `);
  const row = d.prepare("SELECT version FROM _meta LIMIT 1").get() as { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  d.exec(`
    CREATE TABLE IF NOT EXISTS download_queue (
      id            TEXT PRIMARY KEY,
      song_json     TEXT NOT NULL,
      origin_id     TEXT NOT NULL,
      origin_type   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'pending',
      progress      INTEGER DEFAULT 0,
      step_label    TEXT DEFAULT 'Waiting...',
      error         TEXT,
      video_id      TEXT,
      audio_path    TEXT,
      cover_path    TEXT,
      retry_count   INTEGER DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      completed_at  INTEGER
    )
  `);

  d.exec(`CREATE INDEX IF NOT EXISTS idx_download_queue_status ON download_queue(status)`);

  if (currentVersion < 1) {
    d.prepare("INSERT OR IGNORE INTO _meta (version) VALUES (?)").run(SCHEMA_VERSION);
  }
  if (currentVersion < SCHEMA_VERSION) {
    d.prepare("UPDATE _meta SET version = ?").run(SCHEMA_VERSION);
  }
}

function resetInterruptedTasks(): void {
  const d = getDb();
  const interrupted = [
    "searching",
    "downloading-audio",
    "getting-cover",
    "processing-cover",
    "embedding-cover",
  ];
  const stmt = d.prepare(`
    UPDATE download_queue
    SET status = 'pending',
        error = NULL,
        step_label = 'Resuming...',
        progress = 0,
        video_id = NULL,
        audio_path = NULL,
        cover_path = NULL,
        updated_at = ?
    WHERE status IN (${interrupted.map(() => "?").join(",")})
  `);
  const now = Date.now();
  stmt.run(now, ...interrupted);
}

export function getAllTasks(): DownloadTask[] {
  const rows = getDb()
    .prepare("SELECT * FROM download_queue ORDER BY created_at DESC")
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToTask);
}

export function getTaskById(id: string): DownloadTask | null {
  const row = getDb().prepare("SELECT * FROM download_queue WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToTask(row) : null;
}

export function insertTask(task: DownloadTask): void {
  getDb()
    .prepare(
      `INSERT INTO download_queue
       (id, song_json, origin_id, origin_type, status, progress, step_label, error,
        video_id, audio_path, cover_path, retry_count, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      JSON.stringify(task.song),
      task.song.originId,
      task.song.originType,
      task.status,
      task.progress,
      task.stepLabel,
      task.error ?? null,
      task.videoId ?? null,
      task.audioPath ?? null,
      task.coverPath ?? null,
      0,
      task.createdAt,
      task.createdAt,
      task.completedAt ?? null,
    );
}

export function upsertTask(partial: Partial<DownloadTask> & { id: string }): void {
  const existing = getDb().prepare("SELECT * FROM download_queue WHERE id = ?").get(partial.id) as Record<string, unknown> | undefined;
  if (!existing) return;

  const now = Date.now();
  const e = existing;

  const status = partial.status ?? (e.status as string);
  const progress = partial.progress ?? (e.progress as number);
  const stepLabel = partial.stepLabel ?? (e.step_label as string);
  const error = partial.error !== undefined ? partial.error : (e.error as string | null);
  const videoId = partial.videoId !== undefined ? partial.videoId : (e.video_id as string | null);
  const audioPath = partial.audioPath !== undefined ? partial.audioPath : (e.audio_path as string | null);
  const coverPath = partial.coverPath !== undefined ? partial.coverPath : (e.cover_path as string | null);
  const completedAt = partial.completedAt !== undefined ? partial.completedAt : (e.completed_at as number | null);

  const retryCount = (e.retry_count as number) || 0;
  const newRetryCount = partial.status === "pending" && e.status !== "pending" ? retryCount + 1 : retryCount;

  getDb()
    .prepare(
      `UPDATE download_queue
       SET status = ?, progress = ?, step_label = ?, error = ?,
           video_id = ?, audio_path = ?, cover_path = ?,
           retry_count = ?, updated_at = ?, completed_at = ?
       WHERE id = ?`,
    )
    .run(
      status,
      progress,
      stepLabel,
      error ?? null,
      videoId ?? null,
      audioPath ?? null,
      coverPath ?? null,
      newRetryCount,
      now,
      completedAt ?? null,
      partial.id,
    );
}

export function deleteCompletedTasks(): void {
  getDb()
    .prepare("DELETE FROM download_queue WHERE status IN ('completed', 'cancelled')")
    .run();
}

function rowToTask(row: Record<string, unknown>): DownloadTask {
  return {
    id: row.id as string,
    song: JSON.parse(row.song_json as string),
    status: row.status as DownloadStatus,
    progress: (row.progress as number) ?? 0,
    stepLabel: (row.step_label as string) ?? "Waiting...",
    error: (row.error as string) ?? undefined,
    videoId: (row.video_id as string) ?? undefined,
    audioPath: (row.audio_path as string) ?? undefined,
    coverPath: (row.cover_path as string) ?? undefined,
    createdAt: row.created_at as number,
    completedAt: (row.completed_at as number) ?? undefined,
  };
}
