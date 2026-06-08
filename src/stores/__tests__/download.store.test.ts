import { describe, it, expect, beforeEach } from "vitest";
import { DownloadStatus } from "../../types/domain-types";
import type { Song, DownloadTask } from "../../types/domain-types";

type StoreState = {
  tasks: DownloadTask[];
  activeTaskId: string | null;
  isPanelOpen: boolean;
};

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-1",
    originId: "origin-1",
    originType: "local" as any,
    name: "Test Song",
    artistName: "Test Artist",
    duration: 240000,
    imageUrl: null,
    ...overrides,
  };
}

function makeTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: "task-1",
    song: makeSong(),
    status: DownloadStatus.PENDING,
    progress: 0,
    stepLabel: "Waiting...",
    createdAt: Date.now(),
    ...overrides,
  };
}

function initialStoreState(): StoreState {
  return { tasks: [], activeTaskId: null, isPanelOpen: false };
}

function enqueueSong(state: StoreState, song: Song): StoreState {
  if (state.tasks.some((t) => t.song.id === song.id && t.status !== DownloadStatus.CANCELLED)) {
    return state;
  }
  const task: DownloadTask = {
    id: "generated-id",
    song,
    status: DownloadStatus.PENDING,
    progress: 0,
    stepLabel: "Waiting...",
    createdAt: Date.now(),
  };
  return { ...state, tasks: [...state.tasks, task] };
}

function enqueueMultiple(state: StoreState, songs: Song[]): StoreState {
  let current = state;
  for (const song of songs) {
    current = enqueueSong(current, song);
  }
  return current;
}

function cancelTask(state: StoreState, taskId: string): StoreState {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return state;
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, status: DownloadStatus.CANCELLED, stepLabel: "Cancelled" } : t,
    ),
  };
}

function retryTask(state: StoreState, taskId: string): StoreState {
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: DownloadStatus.PENDING, progress: 0, stepLabel: "Waiting...", error: undefined, videoId: undefined, audioPath: undefined, coverPath: undefined }
        : t,
    ),
  };
}

function clearCompleted(state: StoreState): StoreState {
  return {
    ...state,
    tasks: state.tasks.filter(
      (t) => t.status !== DownloadStatus.COMPLETED && t.status !== DownloadStatus.CANCELLED,
    ),
  };
}

function updateTask(state: StoreState, taskId: string, partial: Partial<DownloadTask>): StoreState {
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...partial } : t)),
  };
}

function getPendingCount(state: StoreState): number {
  return state.tasks.filter((t) => t.status === DownloadStatus.PENDING || t.status === DownloadStatus.SEARCHING || t.status === DownloadStatus.DOWNLOADING_AUDIO || t.status === DownloadStatus.GETTING_COVER || t.status === DownloadStatus.PROCESSING_COVER || t.status === DownloadStatus.EMBEDDING_COVER).length;
}

function getCompletedCount(state: StoreState): number {
  return state.tasks.filter((t) => t.status === DownloadStatus.COMPLETED).length;
}

function getFailedCount(state: StoreState): number {
  return state.tasks.filter((t) => t.status === DownloadStatus.FAILED).length;
}

function findNextPending(state: StoreState): DownloadTask | undefined {
  if (state.activeTaskId) return undefined;
  return state.tasks.find((t) => t.status === DownloadStatus.PENDING);
}

function markActive(state: StoreState, taskId: string | null): StoreState {
  return { ...state, activeTaskId: taskId };
}

describe("DownloadStore (pure logic)", () => {
  let state: StoreState;

  beforeEach(() => {
    state = initialStoreState();
  });

  describe("enqueueSong", () => {
    it("should add a song to the task queue", () => {
      const song = makeSong();
      state = enqueueSong(state, song);

      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0].song.id).toBe("song-1");
      expect(state.tasks[0].status).toBe(DownloadStatus.PENDING);
      expect(state.tasks[0].progress).toBe(0);
      expect(state.tasks[0].stepLabel).toBe("Waiting...");
    });

    it("should not add a duplicate song that is already in queue", () => {
      const song = makeSong();
      state = enqueueSong(state, song);
      state = enqueueSong(state, song);

      expect(state.tasks).toHaveLength(1);
    });

    it("should allow re-adding a cancelled song", () => {
      const song = makeSong();
      state = enqueueSong(state, song);

      const taskId = state.tasks[0].id;
      state = updateTask(state, taskId, { status: DownloadStatus.CANCELLED });

      state = enqueueSong(state, song);
      expect(state.tasks).toHaveLength(2);
    });
  });

  describe("enqueueMultiple", () => {
    it("should add multiple songs to the queue", () => {
      const songs = [
        makeSong({ id: "s1", name: "Song 1" }),
        makeSong({ id: "s2", name: "Song 2" }),
        makeSong({ id: "s3", name: "Song 3" }),
      ];
      state = enqueueMultiple(state, songs);

      expect(state.tasks).toHaveLength(3);
    });

    it("should skip duplicates in batch", () => {
      state = enqueueSong(state, makeSong({ id: "s1" }));

      state = enqueueMultiple(state, [
        makeSong({ id: "s1" }),
        makeSong({ id: "s2" }),
      ]);

      expect(state.tasks).toHaveLength(2);
    });
  });

  describe("cancelTask", () => {
    it("should mark a task as cancelled", () => {
      state = { ...state, tasks: [makeTask({ id: "t1" })] };
      state = cancelTask(state, "t1");

      const task = state.tasks.find((t) => t.id === "t1");
      expect(task?.status).toBe(DownloadStatus.CANCELLED);
      expect(task?.stepLabel).toBe("Cancelled");
    });

    it("should do nothing if task not found", () => {
      state = { ...state, tasks: [makeTask({ id: "t1" })] };
      const before = state.tasks.length;
      state = cancelTask(state, "nonexistent");
      expect(state.tasks).toHaveLength(before);
    });
  });

  describe("retryTask", () => {
    it("should reset a failed task to pending", () => {
      state = {
        ...state,
        tasks: [makeTask({
          id: "t1",
          status: DownloadStatus.FAILED,
          error: "Some error",
          progress: 50,
          videoId: "vid123",
          audioPath: "/tmp/audio.mp3",
        })],
      };

      state = retryTask(state, "t1");

      const task = state.tasks.find((t) => t.id === "t1");
      expect(task?.status).toBe(DownloadStatus.PENDING);
      expect(task?.progress).toBe(0);
      expect(task?.error).toBeUndefined();
      expect(task?.videoId).toBeUndefined();
      expect(task?.audioPath).toBeUndefined();
      expect(task?.stepLabel).toBe("Waiting...");
    });
  });

  describe("clearCompleted", () => {
    it("should remove completed and cancelled tasks", () => {
      state = {
        ...state,
        tasks: [
          makeTask({ id: "t1", status: DownloadStatus.COMPLETED }),
          makeTask({ id: "t2", status: DownloadStatus.CANCELLED }),
          makeTask({ id: "t3", status: DownloadStatus.FAILED }),
          makeTask({ id: "t4", status: DownloadStatus.PENDING }),
        ],
      };

      state = clearCompleted(state);

      expect(state.tasks).toHaveLength(2);
      expect(state.tasks.map((t) => t.id)).toEqual(["t3", "t4"]);
    });
  });

  describe("updateTask", () => {
    it("should update partial fields of a task", () => {
      state = { ...state, tasks: [makeTask({ id: "t1" })] };
      state = updateTask(state, "t1", {
        status: DownloadStatus.DOWNLOADING_AUDIO,
        progress: 50,
        stepLabel: "Downloading...",
      });

      const task = state.tasks.find((t) => t.id === "t1");
      expect(task?.status).toBe(DownloadStatus.DOWNLOADING_AUDIO);
      expect(task?.progress).toBe(50);
      expect(task?.stepLabel).toBe("Downloading...");
    });

    it("should not affect other tasks", () => {
      state = {
        ...state,
        tasks: [
          makeTask({ id: "t1" }),
          makeTask({ id: "t2", status: DownloadStatus.COMPLETED }),
        ],
      };
      state = updateTask(state, "t1", { progress: 75 });

      const t2 = state.tasks.find((t) => t.id === "t2");
      expect(t2?.status).toBe(DownloadStatus.COMPLETED);
    });
  });

  describe("getPendingCount", () => {
    it("should count tasks in active states", () => {
      state = {
        ...state,
        tasks: [
          makeTask({ id: "t1", status: DownloadStatus.PENDING }),
          makeTask({ id: "t2", status: DownloadStatus.SEARCHING }),
          makeTask({ id: "t3", status: DownloadStatus.DOWNLOADING_AUDIO }),
          makeTask({ id: "t4", status: DownloadStatus.GETTING_COVER }),
          makeTask({ id: "t5", status: DownloadStatus.PROCESSING_COVER }),
          makeTask({ id: "t6", status: DownloadStatus.EMBEDDING_COVER }),
          makeTask({ id: "t7", status: DownloadStatus.COMPLETED }),
          makeTask({ id: "t8", status: DownloadStatus.FAILED }),
          makeTask({ id: "t9", status: DownloadStatus.CANCELLED }),
        ],
      };

      expect(getPendingCount(state)).toBe(6);
    });
  });

  describe("getCompletedCount", () => {
    it("should count only completed tasks", () => {
      state = {
        ...state,
        tasks: [
          makeTask({ id: "t1", status: DownloadStatus.COMPLETED }),
          makeTask({ id: "t2", status: DownloadStatus.COMPLETED }),
          makeTask({ id: "t3", status: DownloadStatus.FAILED }),
        ],
      };

      expect(getCompletedCount(state)).toBe(2);
    });
  });

  describe("getFailedCount", () => {
    it("should count only failed tasks", () => {
      state = {
        ...state,
        tasks: [
          makeTask({ id: "t1", status: DownloadStatus.FAILED }),
          makeTask({ id: "t2", status: DownloadStatus.COMPLETED }),
        ],
      };

      expect(getFailedCount(state)).toBe(1);
    });
  });

  describe("findNextPending", () => {
    it("should return undefined if another task is already active", () => {
      state = {
        ...state,
        tasks: [
          makeTask({ id: "t1", status: DownloadStatus.PENDING }),
          makeTask({ id: "t2", status: DownloadStatus.PENDING }),
        ],
        activeTaskId: "t1",
      };

      expect(findNextPending(state)).toBeUndefined();
    });

    it("should return undefined if no pending tasks", () => {
      state = {
        ...state,
        tasks: [makeTask({ id: "t1", status: DownloadStatus.COMPLETED })],
      };

      expect(findNextPending(state)).toBeUndefined();
    });

    it("should return the first pending task", () => {
      state = {
        ...state,
        tasks: [
          makeTask({ id: "t1", status: DownloadStatus.PENDING }),
          makeTask({ id: "t2", status: DownloadStatus.PENDING }),
        ],
      };

      const next = findNextPending(state);
      expect(next?.id).toBe("t1");
    });
  });
});
