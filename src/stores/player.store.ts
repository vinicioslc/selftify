import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PlayerStatus, PlayerRepeat, PlayerShuffle, QueueSong, Song, PlayQueueAddOptions } from "../types/domain-types";
import { generateId } from "../lib/utils";

type PlayerState = {
  currentTrack: QueueSong | null;
  queue: QueueSong[];
  originalQueue: QueueSong[];
  status: PlayerStatus;
  volume: number;
  seek: number;
  seekId: number;
  duration: number;
  repeat: PlayerRepeat;
  shuffle: PlayerShuffle;
  positionMs: number;
  resumeMs: number;
  pendingResume: boolean;
  isBuffering: boolean;
  isFullScreen: boolean;
  fullScreenTab: string; // "queue" | "lyrics" | "visualizer"
  transitionProgress: number; // 0 = no transition, 0-1 = crossfade progress

  setVolume: (volume: number) => void;
  setResumeMs: (ms: number) => void;
  setSeek: (seek: number) => void;
  setDuration: (duration: number) => void;
  setPositionMs: (ms: number) => void;
  setBuffering: (buffering: boolean) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  setQueue: (songs: Song[], options?: PlayQueueAddOptions) => void;
  addToQueue: (songs: Song[], options?: PlayQueueAddOptions) => void;
  removeFromQueue: (queueId: string) => void;
  clearQueue: () => void;
  setCurrentTrack: (song: Song | null) => void;
  setIsFullScreen: (value: boolean) => void;
  toggleFullScreen: () => void;
  setFullScreenTab: (tab: string) => void;
  setTransitionProgress: (progress: number) => void;
};

function buildQueue(songs: Song[]): QueueSong[] {
  return songs.map((song, index) => ({
    ...song,
    queueId: generateId(),
    queueIndex: index,
  }));
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      originalQueue: [],
      status: PlayerStatus.STOPPED,
      volume: 0.8,
      seek: 0,
      seekId: 0,
      duration: 0,
      repeat: PlayerRepeat.NONE,
      shuffle: PlayerShuffle.NONE,
      positionMs: 0,
      resumeMs: 0,
      pendingResume: false,
      isBuffering: false,
      isFullScreen: false,
      fullScreenTab: "queue",
      transitionProgress: 0,

      setVolume: (volume) => set({ volume }),
      setResumeMs: (ms) => set({ resumeMs: ms }),
  setSeek: (seek) => set((state) => ({ seek, seekId: state.seekId + 1 })),
  setDuration: (duration) => set({ duration }),
  setPositionMs: (positionMs) => set({ positionMs }),
  setBuffering: (isBuffering) => set({ isBuffering }),

  play: () => set({ status: PlayerStatus.PLAYING }),
  pause: () => set((s) => ({ status: PlayerStatus.PAUSED, resumeMs: s.positionMs })),
  stop: () => set({ status: PlayerStatus.STOPPED, currentTrack: null, seek: 0, positionMs: 0, resumeMs: 0, pendingResume: false }),
  togglePlay: () => {
    const { status } = get();
    set({ status: status === PlayerStatus.PLAYING ? PlayerStatus.PAUSED : PlayerStatus.PLAYING });
  },

  next: () => {
    const { queue, currentTrack, repeat } = get();
    if (!currentTrack || queue.length === 0) return;
    const currentIndex = queue.findIndex((t) => t.queueId === currentTrack.queueId);
    if (currentIndex < queue.length - 1) {
      set({ currentTrack: queue[currentIndex + 1], seek: 0, positionMs: 0, resumeMs: 0, pendingResume: false });
    } else if (repeat === PlayerRepeat.ALL) {
      set({ currentTrack: queue[0], seek: 0, positionMs: 0, resumeMs: 0, pendingResume: false });
    }
  },

  previous: () => {
    const { queue, currentTrack, setSeek } = get();
    if (!currentTrack || queue.length === 0) return;
    const currentIndex = queue.findIndex((t) => t.queueId === currentTrack.queueId);
    if (currentIndex > 0) {
      set({ currentTrack: queue[currentIndex - 1], positionMs: 0 });
      setSeek(0);
    } else {
      setSeek(0);
      set({ positionMs: 0 });
    }
  },

  toggleRepeat: () => {
    const { repeat } = get();
    const next = repeat === PlayerRepeat.NONE ? PlayerRepeat.ALL : repeat === PlayerRepeat.ALL ? PlayerRepeat.ONE : PlayerRepeat.NONE;
    set({ repeat: next });
  },

  toggleShuffle: () => {
    const { shuffle, queue, originalQueue } = get();
    if (shuffle === PlayerShuffle.NONE) {
      const shuffled = [...queue].sort(() => Math.random() - 0.5);
      set({ queue: shuffled, originalQueue: queue, shuffle: PlayerShuffle.TRACK });
    } else {
      set({ queue: originalQueue, originalQueue: [], shuffle: PlayerShuffle.NONE });
    }
  },

  setQueue: (songs, options) => {
    const newQueue = buildQueue(songs);
    set({ queue: newQueue, originalQueue: [] });
    if (options?.type === "now" || !options) {
      const startIndex = options?.startIndex || 0;
      set({ currentTrack: newQueue[startIndex] || newQueue[0] || null, seek: 0, positionMs: 0, resumeMs: 0, pendingResume: false, status: PlayerStatus.PLAYING });
    }
  },

  addToQueue: (songs, options) => {
    const { queue, currentTrack } = get();
    const newSongs = buildQueue(songs);
    const offset = queue.length;

    if (options?.type === "next") {
      const currentIndex = currentTrack ? queue.findIndex((t) => t.queueId === currentTrack.queueId) : -1;
      const insertAt = currentIndex >= 0 ? currentIndex + 1 : 0;
      const newQueue = [...queue];
      newSongs.forEach((s, i) => {
        s.queueIndex = insertAt + i;
      });
      newQueue.splice(insertAt, 0, ...newSongs);
      newQueue.forEach((s, i) => (s.queueIndex = i));
      set({ queue: newQueue });
    } else if (options?.type === "now") {
      const startIndex = options?.startIndex || 0;
      const newQueue = buildQueue(songs);
      set({ currentTrack: newQueue[startIndex] || newQueue[0] || null, seek: 0, positionMs: 0, resumeMs: 0, pendingResume: false, status: PlayerStatus.PLAYING, queue: [...queue, ...newQueue] });
    } else {
      newSongs.forEach((s, i) => (s.queueIndex = offset + i));
      set({ queue: [...queue, ...newSongs] });
    }
  },

  removeFromQueue: (queueId) => {
    const { queue, currentTrack } = get();
    const newQueue = queue.filter((s) => s.queueId !== queueId);
    newQueue.forEach((s, i) => (s.queueIndex = i));
    if (currentTrack?.queueId === queueId) {
      const nextTrack = newQueue[Math.min(queue.indexOf(currentTrack), newQueue.length - 1)];
      set({ queue: newQueue, currentTrack: nextTrack || null, seek: 0, positionMs: 0, resumeMs: 0, pendingResume: false });
    } else {
      set({ queue: newQueue });
    }
  },

  clearQueue: () => set({ queue: [], originalQueue: [], currentTrack: null, status: PlayerStatus.STOPPED, seek: 0, positionMs: 0, resumeMs: 0, pendingResume: false }),

  setCurrentTrack: (song) => {
    if (!song) {
      set({ currentTrack: null, status: PlayerStatus.STOPPED, seek: 0, positionMs: 0, resumeMs: 0, pendingResume: false });
      return;
    }
    const queueSong: QueueSong = { ...song, queueId: generateId(), queueIndex: 0 };
    set({ currentTrack: queueSong, seek: 0, positionMs: 0, resumeMs: 0, pendingResume: false, status: PlayerStatus.PLAYING });
  },

  setIsFullScreen: (isFullScreen) => set({ isFullScreen }),
  toggleFullScreen: () => set((state) => ({ isFullScreen: !state.isFullScreen })),
  setFullScreenTab: (fullScreenTab) => set({ fullScreenTab }),
  setTransitionProgress: (transitionProgress) => set({ transitionProgress }),
    }),
    {
      name: "ytmusic-player",
      partialize: (state) => ({
        currentTrack: state.currentTrack,
        queue: state.queue,
        originalQueue: state.originalQueue,
        volume: state.volume,
        repeat: state.repeat,
        shuffle: state.shuffle,
        duration: state.duration,
        resumeMs: state.resumeMs,
        pendingResume: state.pendingResume,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlayerState>;
        return {
          ...current,
          ...p,
          status: PlayerStatus.PAUSED,
          positionMs: p.resumeMs ?? 0,
          pendingResume: (p.resumeMs ?? 0) > 0,
          isBuffering: false,
          transitionProgress: 0,
        };
      },
    }
  )
);
