import { create } from "zustand";
import type { Song, DownloadTask } from "../types/domain-types";
import { DownloadStatus } from "../types/domain-types";
import { useStatusStore } from "./status.store";
import { useBackendStore } from "./backend.store";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:6189";

type DownloadStore = {
  tasks: DownloadTask[];
  isPanelOpen: boolean;
  _eventSource: EventSource | null;

  _hasActiveTasks: () => boolean;
  _initSse: () => void;
  _closeSse: () => void;

  hydrate: () => void;
  enqueueSong: (song: Song) => Promise<void>;
  enqueueMultiple: (songs: Song[]) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  setPanelOpen: (open: boolean) => void;

  isInQueue: (song: Song) => boolean;
  getPendingCount: () => number;
  getCompletedCount: () => number;
  getFailedCount: () => number;
};

export const useDownloadStore = create<DownloadStore>()((set, get) => ({
  tasks: [],
  isPanelOpen: false,
  _eventSource: null,

  _hasActiveTasks: () => {
    const { tasks } = get();
    return tasks.some((t) =>
      t.status === DownloadStatus.PENDING ||
      t.status === DownloadStatus.SEARCHING ||
      t.status === DownloadStatus.DOWNLOADING_AUDIO ||
      t.status === DownloadStatus.GETTING_COVER ||
      t.status === DownloadStatus.PROCESSING_COVER ||
      t.status === DownloadStatus.EMBEDDING_COVER,
    );
  },

  _initSse: () => {
    get()._closeSse();
    const backend = useBackendStore.getState();
    if (!backend.config || !backend.capabilities.includes("download")) return;

    const sse = new EventSource(`${API_BASE}/api/selftify/download/events`);
    set({ _eventSource: sse });

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "task-created" || data.event === "task-updated") {
          const task = data.data as DownloadTask;
          set((state) => {
            const existing = state.tasks.find((t) => t.id === task.id);
            if (existing) {
              return {
                tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
              };
            }
            return { tasks: [...state.tasks, task] };
          });
        } else if (data.event === "task-deleted") {
          set((state) => ({
            tasks: state.tasks.filter((t) => t.id !== data.data.id),
          }));
        } else if (data.event === "tasks-cleared") {
          set({ tasks: [] });
        }
      } catch {
        // ignore malformed events
      }
    };

    sse.onerror = () => {
      // Auto-reconnect is handled by EventSource, but we can add custom logic if needed
    };
  },

  _closeSse: () => {
    const { _eventSource } = get();
    if (_eventSource) {
      _eventSource.close();
      set({ _eventSource: null });
    }
  },

  hydrate: async () => {
    const backend = useBackendStore.getState();
    if (!backend.config || !backend.capabilities.includes("download")) return;

    try {
      const resp = await fetch(`${API_BASE}/api/selftify/download/tasks`);
      if (!resp.ok) return;
      const data = await resp.json();
      set({ tasks: data.tasks || [] });
      if (get()._hasActiveTasks()) get()._initSse();
    } catch {
      // server unreachable — keep current tasks
    }
  },

  enqueueSong: async (song: Song) => {
    const backend = useBackendStore.getState();
    if (!backend.config || !backend.capabilities.includes("download")) {
      useStatusStore.getState().addMessage("Download not available — no backend connected", "warn", "Download");
      return;
    }

    const existing = get().tasks.find(
      (t) => t.song.id === song.id && t.status !== DownloadStatus.CANCELLED,
    );
    if (existing) {
      useStatusStore.getState().addMessage("Song is already in download queue", "info", "Download");
      set({ isPanelOpen: true });
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/api/selftify/download/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ song }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any)?.error || `Server returned ${resp.status}`);
      }
      const data = await resp.json() as any;
      if (data.task) {
        useStatusStore.getState().addMessage(
          `Added "${song.name}" to download queue`,
          "info",
          "Download",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useStatusStore.getState().addMessage(`Failed to enqueue download: ${msg}`, "danger", "Download");
    }
  },

  enqueueMultiple: async (songs: Song[]) => {
    const backend = useBackendStore.getState();
    if (!backend.config || !backend.capabilities.includes("download")) {
      useStatusStore.getState().addMessage("Download not available — no backend connected", "warn", "Download");
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/api/selftify/download/enqueue-multiple`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songs }),
      });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const data = await resp.json() as any;
      if (data.tasks?.length > 0) {
        useStatusStore.getState().addMessage(
          `Added ${data.tasks.length} songs to download queue`,
          "info",
          "Download",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useStatusStore.getState().addMessage(`Failed to enqueue downloads: ${msg}`, "danger", "Download");
    }
  },

  cancelTask: async (taskId: string) => {
    try {
      await fetch(`${API_BASE}/api/selftify/download/tasks/${taskId}/cancel`, { method: "POST" });
    } catch { /* ignore */ }
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: DownloadStatus.CANCELLED, stepLabel: "Cancelled" }
          : t,
      ),
    }));
  },

  retryTask: async (taskId: string) => {
    try {
      await fetch(`${API_BASE}/api/selftify/download/tasks/${taskId}/retry`, { method: "POST" });
    } catch { /* ignore */ }
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: DownloadStatus.PENDING, progress: 0, stepLabel: "Waiting...", error: undefined }
          : t,
      ),
    }));
  },

  clearCompleted: async () => {
    try {
      await fetch(`${API_BASE}/api/selftify/download/tasks/completed`, { method: "DELETE" });
    } catch { /* ignore */ }
    set((state) => ({
      tasks: state.tasks.filter(
        (t) => t.status !== DownloadStatus.COMPLETED && t.status !== DownloadStatus.CANCELLED,
      ),
    }));
  },

  setPanelOpen: (open: boolean) => {
    set({ isPanelOpen: open });
    if (open) {
      if (!get()._hasActiveTasks()) get()._initSse();
    }
  },

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
}));

export function useDownloadStoreHydrate() {
  const hydrate = useDownloadStore.getState().hydrate;
  useDownloadStore.setState({ _eventSource: null, tasks: [] });
  hydrate();
}