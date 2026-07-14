import { getDb } from "../db/connection";

export interface DownloadTaskRow {
  id: string;
  name: string;
  artistName: string;
  albumName?: string;
  albumArtistName?: string;
  trackNumber?: number;
  discNumber?: number;
  duration: number | null;
  bitrate?: number;
  genres?: string[];
  releaseYear?: number;
  imageUrl: string | null;
  mbzRecordingId?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzAlbumId?: string;
  youtubeVideoId?: string;
}

export interface DownloadTask {
  id: string;
  song: DownloadTaskRow;
  status: string;
  progress: number;
  stepLabel: string;
  error?: string;
  videoId?: string;
  audioPath?: string;
  coverPath?: string;
  createdAt: number;
  completedAt?: number;
}

interface TaskRow {
  id: string;
  song_id: string;
  song_json: string;
  status: string;
  progress: number;
  step_label: string;
  error: string | null;
  video_id: string | null;
  audio_path: string | null;
  cover_path: string | null;
  created_at: number;
  completed_at: number | null;
}

function rowToTask(row: TaskRow): DownloadTask {
  const song = JSON.parse(row.song_json) as DownloadTaskRow;
  return {
    id: row.id,
    song: { ...song, id: row.song_id },
    status: row.status,
    progress: row.progress,
    stepLabel: row.step_label,
    error: row.error ?? undefined,
    videoId: row.video_id ?? undefined,
    audioPath: row.audio_path ?? undefined,
    coverPath: row.cover_path ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function createTask(
  id: string,
  song: DownloadTaskRow,
  createdAt: number,
): void {
  const db = getDb();
  const songJson = JSON.stringify(song);
  db.prepare(
    `INSERT INTO download_tasks (id, song_id, song_json, status, progress, step_label, created_at)
     VALUES (?, ?, ?, 'pending', 0, 'Waiting...', ?)`,
  ).run(id, song.id, songJson, createdAt);
}

export function getTaskById(id: string): DownloadTask | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM download_tasks WHERE id = ?").get(id) as
    | TaskRow
    | undefined;
  return row ? rowToTask(row) : null;
}

export function getAllTasks(): DownloadTask[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM download_tasks ORDER BY created_at DESC")
    .all() as TaskRow[];
  return rows.map(rowToTask);
}

export function updateTaskStatus(
  id: string,
  partial: Partial<{
    status: string;
    progress: number;
    stepLabel: string;
    error: string | null;
    videoId: string | null;
    audioPath: string | null;
    coverPath: string | null;
    completedAt: number | null;
  }>,
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (partial.status !== undefined) {
    sets.push("status = ?");
    values.push(partial.status);
  }
  if (partial.progress !== undefined) {
    sets.push("progress = ?");
    values.push(partial.progress);
  }
  if (partial.stepLabel !== undefined) {
    sets.push("step_label = ?");
    values.push(partial.stepLabel);
  }
  if (partial.error !== undefined) {
    sets.push("error = ?");
    values.push(partial.error);
  }
  if (partial.videoId !== undefined) {
    sets.push("video_id = ?");
    values.push(partial.videoId);
  }
  if (partial.audioPath !== undefined) {
    sets.push("audio_path = ?");
    values.push(partial.audioPath);
  }
  if (partial.coverPath !== undefined) {
    sets.push("cover_path = ?");
    values.push(partial.coverPath);
  }
  if (partial.completedAt !== undefined) {
    sets.push("completed_at = ?");
    values.push(partial.completedAt);
  }

  if (sets.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE download_tasks SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}

export function deleteTask(id: string): void {
  getDb().prepare("DELETE FROM download_tasks WHERE id = ?").run(id);
}

export function deleteCompletedTasks(): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id FROM download_tasks WHERE status IN ('completed', 'cancelled')",
    )
    .all() as { id: string }[];
  const ids = rows.map(r => r.id);
  db
    .prepare("DELETE FROM download_tasks WHERE status IN ('completed', 'cancelled')")
    .run();
  return ids;
}

export function getPendingTasks(): DownloadTask[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM download_tasks WHERE status = 'pending' ORDER BY created_at ASC",
    )
    .all() as TaskRow[];
  return rows.map(rowToTask);
}

export function taskExists(songId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id FROM download_tasks WHERE song_id = ? AND status != 'cancelled' LIMIT 1",
    )
    .get(songId) as { id: string } | undefined;
  return !!row;
}

export function getTaskBySongId(songId: string): DownloadTask | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM download_tasks WHERE song_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(songId) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}