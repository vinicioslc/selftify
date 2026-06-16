import { create } from "zustand";
import type { Song, DownloadTask } from "../types/domain-types";
import { DownloadStatus } from "../types/domain-types";
import { generateId } from "../lib/utils";
import { useStatusStore } from "./status.store";
import { processTask } from "../services/download-queue";

type DownloadStore = {
  tasks: DownloadTask[];
  activeTaskId: string | null;
  isPanelOpen: boolean;

  enqueueSong: (song: Song) => void;
  enqueueMultiple: (songs: Song[]) => void;
  cancelTask: (taskId: string) => void;
  retryTask: (taskId: string) => void;
  clearCompleted: () => void;
  updateTask: (taskId: string, partial: Partial<DownloadTask>) => void;
  setPanelOpen: (open: boolean) => void;

  isInQueue: (song: Song) => boolean;
  getPendingCount: () => number;
  getCompletedCount: () => number;
  getFailedCount: () => number;
  processNext: () => Promise<void>;
};

export const useDownloadStore = create<DownloadStore>()((set, get) => ({
  tasks: [],
  activeTaskId: null,
  isPanelOpen: false,

  enqueueSong: (song: Song) => {
    const { tasks } = get();
    if (tasks.some((t) => t.song.id === song.id && t.status !== DownloadStatus.CANCELLED)) {
      useStatusStore.getState().addMessage("Song is already in download queue", "info", "Download");
      return;
    }
    const task: DownloadTask = {
      id: generateId(),
      song,
      status: DownloadStatus.PENDING,
      progress: 0,
      stepLabel: "Waiting...",
      createdAt: Date.now(),
    };
    set((state) => ({ tasks: [...state.tasks, task] }));
    useStatusStore.getState().addMessage(`Added "${song.name}" to download queue`, "info", "Download");
    get().processNext();
  },

  enqueueMultiple: (songs: Song[]) => {
    for (const song of songs) {
      get().enqueueSong(song);
    }
  },

  cancelTask: async (taskId: string) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status: DownloadStatus.CANCELLED, stepLabel: "Cancelled" } : t,
      ),
    }));
    if (task.audioPath) {
      try {
        const { getDownloadPlatform } = await import("../services/download-platform");
        await getDownloadPlatform().deleteFile(task.audioPath);
      } catch { /* ignore cleanup errors */ }
    }
    if (task.coverPath) {
      try {
        const { getDownloadPlatform } = await import("../services/download-platform");
        await getDownloadPlatform().deleteFile(task.coverPath);
      } catch { /* ignore cleanup errors */ }
    }
    get().processNext();
  },

  retryTask: (taskId: string) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: DownloadStatus.PENDING, progress: 0, stepLabel: "Waiting...", error: undefined, videoId: undefined, audioPath: undefined, coverPath: undefined }
          : t,
      ),
    }));
    get().processNext();
  },

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter(
        (t) => t.status !== DownloadStatus.COMPLETED && t.status !== DownloadStatus.CANCELLED,
      ),
    }));
  },

  updateTask: (taskId: string, partial: Partial<DownloadTask>) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...partial } : t)),
    }));
  },

  setPanelOpen: (open: boolean) => set({ isPanelOpen: open }),

  isInQueue: (song: Song) => get().tasks.some((t) => t.song.id === song.id && t.status !== DownloadStatus.CANCELLED),

  getPendingCount: () => get().tasks.filter((t) => t.status === DownloadStatus.PENDING || t.status === DownloadStatus.SEARCHING || t.status === DownloadStatus.DOWNLOADING_AUDIO || t.status === DownloadStatus.GETTING_COVER || t.status === DownloadStatus.PROCESSING_COVER || t.status === DownloadStatus.EMBEDDING_COVER).length,

  getCompletedCount: () => get().tasks.filter((t) => t.status === DownloadStatus.COMPLETED).length,

  getFailedCount: () => get().tasks.filter((t) => t.status === DownloadStatus.FAILED).length,

  processNext: async () => {
    const { tasks, activeTaskId } = get();
    if (activeTaskId) return;
    const next = tasks.find((t) => t.status === DownloadStatus.PENDING);
    if (!next) return;
    set({ activeTaskId: next.id });
    try {
      await processTask(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      get().updateTask(next.id, { status: DownloadStatus.FAILED, error: msg, stepLabel: `Error: ${msg}`, progress: 0 });
      useStatusStore.getState().addMessage(`Download failed: ${msg}`, "danger", "Download");
    } finally {
      set({ activeTaskId: null });
      get().processNext();
    }
  },
}));
