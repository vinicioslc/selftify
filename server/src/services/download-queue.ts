import crypto from "crypto";
import { isYtDlpAvailable } from "./download-service";
import { searchYouTube, isSearchAvailable } from "./youtube-search";
import { downloadCover } from "./cover-download";
import { addToLibrary } from "./library-writer";
import * as repo from "../repositories/download-repo";
import { type StreamResolver, type ResolveRequest, YtDlpStreamResolver } from "./stream-resolver";
import { broadcast } from "./sse-events";

/** Test helper: set to false to prevent auto-processing on enqueue */
let _processOnEnqueue = true;
export function _setProcessOnEnqueue(val: boolean): void {
  _processOnEnqueue = val;
}

/** The stream resolver used by the queue. Swappable for testing. */
let _resolver: StreamResolver = new YtDlpStreamResolver();
export function _setResolver(r: StreamResolver): void {
  _resolver = r;
}

const ACTIVE_STATUSES = new Set([
  "pending", "searching", "downloading-audio",
  "getting-cover", "processing-cover", "embedding-cover",
]);

export type TaskStatus =
  | "pending"
  | "searching"
  | "downloading-audio"
  | "getting-cover"
  | "processing-cover"
  | "embedding-cover"
  | "completed"
  | "failed"
  | "cancelled";

export type DownloadTask = repo.DownloadTask;

let activeTaskId: string | null = null;

function generateId(): string {
  return crypto.randomUUID();
}

export function getTasks(): DownloadTask[] {
  return repo.getAllTasks();
}

export function getTask(id: string): DownloadTask | null {
  return repo.getTaskById(id);
}

export function enqueueTask(song: DownloadTask["song"]): DownloadTask {
  if (repo.taskExists(song.id)) {
    const existing = repo.getTaskBySongId(song.id);
    if (existing) return existing;
  }

  const id = generateId();
  const createdAt = Date.now();
  repo.createTask(id, song, createdAt);
  const task = repo.getTaskById(id);
  if (!task) throw new Error("Failed to create download task");
  broadcast("task-created", task);
  if (_processOnEnqueue) processNext();
  return task;
}

export function enqueueMultiple(songs: DownloadTask["song"][]): DownloadTask[] {
  const created: DownloadTask[] = [];
  const now = Date.now();

  for (const song of songs) {
    if (repo.taskExists(song.id)) {
      const existing = repo.getTaskBySongId(song.id);
      if (existing) {
        created.push(existing);
        continue;
      }
    }
    const id = generateId();
    repo.createTask(id, song, now);
    const task = repo.getTaskById(id);
    if (task) {
      broadcast("task-created", task);
      created.push(task);
    }
  }

  if (_processOnEnqueue) processNext();
  return created;
}

export function cancelTask(id: string): boolean {
  const task = repo.getTaskById(id);
  if (!task) return false;
  if (task.status === "pending") {
    repo.updateTaskStatus(id, {
      status: "cancelled",
      stepLabel: "Cancelled",
    });
    broadcast("task-updated", repo.getTaskById(id));
    processNext();
    return true;
  }
  if (ACTIVE_STATUSES.has(task.status)) {
    repo.updateTaskStatus(id, {
      status: "cancelled",
      stepLabel: "Cancelled",
    });
    broadcast("task-updated", repo.getTaskById(id));
    processNext();
    return true;
  }
  return false;
}

export function retryTask(id: string): boolean {
  const task = repo.getTaskById(id);
  if (!task || (task.status !== "failed" && task.status !== "cancelled")) return false;
  repo.updateTaskStatus(id, {
    status: "pending",
    progress: 0,
    stepLabel: "Waiting...",
    error: null,
    videoId: null,
    audioPath: null,
    coverPath: null,
    completedAt: null,
  });
  broadcast("task-updated", repo.getTaskById(id));
  processNext();
  return true;
}

export function clearCompleted(): void {
  const ids = repo.deleteCompletedTasks();
  for (const id of ids) {
    broadcast("task-deleted", { id });
  }
  if (ids.length > 0) {
    broadcast("tasks-cleared", { count: ids.length });
  }
}

export function processNext(): void {
  if (!_processOnEnqueue) return;
  if (activeTaskId) return;
  const pending = repo.getPendingTasks();
  if (pending.length === 0) return;
  const next = pending[0];
  activeTaskId = next.id;
  executeTask(next).finally(() => {
    activeTaskId = null;
    processNext();
  });
}

async function executeTask(task: DownloadTask): Promise<void> {
  const setStatus = (status: string, progress: number, stepLabel: string) => {
    repo.updateTaskStatus(task.id, { status, progress, stepLabel });
    broadcast("task-updated", repo.getTaskById(task.id));
  };
  const setError = (error: string) => {
    repo.updateTaskStatus(task.id, {
      status: "failed",
      error,
      stepLabel: `Error: ${error}`,
      progress: 0,
    });
    broadcast("task-updated", repo.getTaskById(task.id));
  };

  try {
    if (!isYtDlpAvailable()) {
      setError("yt-dlp binary not found on the server");
      return;
    }

    // Step 1: Resolve videoId (use cached or search YouTube)
    let videoId = task.song.youtubeVideoId;
    if (!videoId) {
      if (repo.getTaskById(task.id)?.status === "cancelled") return;
      if (!isSearchAvailable()) {
        setError("yt-dlp binary not available for YouTube search");
        return;
      }
      setStatus("searching", 5, "Searching YouTube...");
      const searchResult = await searchYouTube(
        `${task.song.artistName} ${task.song.name}`,
      );
      if (!searchResult) {
        setError("No YouTube match found for this song");
        return;
      }
      videoId = searchResult.id;
      repo.updateTaskStatus(task.id, { videoId, progress: 10 });
      broadcast("task-updated", repo.getTaskById(task.id));
    }

    if (repo.getTaskById(task.id)?.status === "cancelled") return;

    // Step 2: Fetch cover art BEFORE audio conversion so it can be embedded
    setStatus("getting-cover", 15, "Fetching cover art...");
    const coverBytes = await downloadCover(
      task.song.artistName,
      task.song.albumName || `${task.song.name} (Single)`,
      task.song.imageUrl,
      videoId,
    );

    if (repo.getTaskById(task.id)?.status === "cancelled") return;

    // Step 3: Download audio + convert to MP3 + embed cover + embed metadata
    setStatus("downloading-audio", 25, "Downloading audio...");
    const resolveReq: ResolveRequest = {
      videoId,
      searchQuery: `${task.song.artistName} ${task.song.name}`,
      songName: task.song.name,
      artistName: task.song.artistName,
      albumName: task.song.albumName,
      albumArtistName: task.song.albumArtistName,
      trackNumber: task.song.trackNumber,
      releaseYear: task.song.releaseYear,
      genres: task.song.genres,
      coverBytes: coverBytes,
    };
    const result = await _resolver.resolve(resolveReq);
    repo.updateTaskStatus(task.id, {
      audioPath: result.filePath,
      coverPath: result.coverPath,
      progress: 90,
    });
    broadcast("task-updated", repo.getTaskById(task.id));

    if (repo.getTaskById(task.id)?.status === "cancelled") return;

    // Step 4: Insert into library
    setStatus("processing-cover", 95, "Adding to library...");
    await addToLibrary(result.filePath, task.song);

    repo.updateTaskStatus(task.id, {
      status: "completed",
      progress: 100,
      stepLabel: "Completed",
      completedAt: Date.now(),
    });
    broadcast("task-updated", repo.getTaskById(task.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setError(msg);
  }
}