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
  _hydrated: boolean;
  _cleanupListener: (() => void) | null;

  hydrate: () => Promise<void>;
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

function getElectronDownloadApi(): any {
  if (typeof window !== "undefined" && (window as any).electronApi?.download) {
    return (window as any).electronApi.download;
  }
  return null;
}

export const useDownloadStore = create<DownloadStore>()((set, get) => ({
  tasks: [],
  activeTaskId: null,
  isPanelOpen: false,
  _hydrated: false,
  _cleanupListener: null,

  hydrate: async () => {
    if (get()._hydrated) return;
    const api = getElectronDownloadApi();
    if (api) {
      try {
        const tasks = await api.getAllTasks();
        set({ tasks, _hydrated: true });
        get().processNext();
      } catch {
        set({ _hydrated: true });
      }
      const cleanup = api.onTaskUpdate((updated: DownloadTask) => {
        set((state) => {
          const existing = state.tasks.findIndex((t) => t.id === updated.id);
          if (existing >= 0) {
            const tasks = [...state.tasks];
            tasks[existing] = updated;
            return { tasks };
          }
          return { tasks: [...state.tasks, updated] };
        });
      });
      set({ _cleanupListener: cleanup });
    } else {
      set({ _hydrated: true });
    }
  },

  enqueueSong: (song: Song) => {
    const api = getElectronDownloadApi();
    if (api) {
      const { tasks } = get();
      if (tasks.some((t) => t.song.id === song.id && t.status !== DownloadStatus.CANCELLED)) {
        useStatusStore.getState().addMessage("Song is already in download queue", "info", "Download");
        return;
      }
      api.enqueueSong(song).then((task: DownloadTask | null) => {
        if (!task) {
          useStatusStore.getState().addMessage("Song is already in download queue", "info", "Download");
          return;
        }
        set((state) => {
          if (state.tasks.some((t) => t.id === task.id)) return state;
          return { tasks: [...state.tasks, task] };
        });
        useStatusStore.getState().addMessage(`Added "${song.name}" to download queue`, "info", "Download");
        get().processNext();
      });
      return;
    }

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
    const api = getElectronDownloadApi();
    if (api) {
      api.enqueueMultiple(songs).then((newTasks: DownloadTask[]) => {
        if (newTasks.length === 0) return;
        set((state) => ({ tasks: [...state.tasks, ...newTasks] }));
        useStatusStore.getState().addMessage(`Added ${newTasks.length} songs to download queue`, "info", "Download");
        get().processNext();
      });
      return;
    }

    for (const song of songs) {
      get().enqueueSong(song);
    }
  },

  cancelTask: async (taskId: string) => {
    const api = getElectronDownloadApi();
    if (api) {
      await api.cancelTask(taskId).catch(() => {});
    }

    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status: DownloadStatus.CANCELLED, stepLabel: "Cancelled" } : t,
      ),
    }));
    const { getDownloadPlatform } = await import("../services/download-platform");
    if (task.audioPath) {
      try { await getDownloadPlatform().deleteFile(task.audioPath); } catch { }
    }
    if (task.coverPath) {
      try { await getDownloadPlatform().deleteFile(task.coverPath); } catch { }
    }
    get().processNext();
  },

  retryTask: (taskId: string) => {
    const api = getElectronDownloadApi();
    if (api) {
      api.retryTask(taskId).catch(() => {});
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status: DownloadStatus.PENDING, progress: 0, stepLabel: "Waiting...", error: undefined, videoId: undefined, audioPath: undefined, coverPath: undefined }
            : t,
        ),
      }));
      get().processNext();
      return;
    }

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
    const api = getElectronDownloadApi();
    if (api) {
      api.clearCompleted().catch(() => {});
    }
    set((state) => ({
      tasks: state.tasks.filter(
        (t) => t.status !== DownloadStatus.COMPLETED && t.status !== DownloadStatus.CANCELLED,
      ),
    }));
  },

  updateTask: (taskId: string, partial: Partial<DownloadTask>) => {
    const api = getElectronDownloadApi();
    if (api) {
      api.updateTask(taskId, partial).catch(() => {});
    }
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...partial } : t)),
    }));
  },

  setPanelOpen: (open: boolean) => set({ isPanelOpen: open }),

  isInQueue: (song: Song) => get().tasks.some(
    (t) => t.song.id === song.id && t.status !== DownloadStatus.CANCELLED,
  ),

  getPendingCount: () => get().tasks.filter(
    (t) => t.status === DownloadStatus.PENDING
      || t.status === DownloadStatus.SEARCHING
      || t.status === DownloadStatus.DOWNLOADING_AUDIO
      || t.status === DownloadStatus.GETTING_COVER
      || t.status === DownloadStatus.PROCESSING_COVER
      || t.status === DownloadStatus.EMBEDDING_COVER,
  ).length,

  getCompletedCount: () => get().tasks.filter((t) => t.status === DownloadStatus.COMPLETED).length,

  getFailedCount: () => get().tasks.filter((t) => t.status === DownloadStatus.FAILED).length,

  processNext: async () => {
    if (!get()._hydrated) await get().hydrate();
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
