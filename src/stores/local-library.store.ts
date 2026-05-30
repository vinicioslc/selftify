import { create } from "zustand";
import { persist } from "zustand/middleware";
import { OriginType } from "../types/domain-types";

export type LocalScanStatus = "idle" | "scanning" | "paused" | "done" | "error";

export type LocalLibraryEntry = {
  id: string;
  path: string;
  name: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  imageUrl: string | null;
  size: number | null;
  lastModified: number | null;
  addedAt: number;
};

type ScanProgress = {
  total: number;
  done: number;
  currentDir: string;
};

type LocalLibraryState = {
  rootFolder: string;
  entries: LocalLibraryEntry[];
  scanStatus: LocalScanStatus;
  scanProgress: ScanProgress;
  lastScanned: number | null;
  scanningOriginId: string | null;
  dirQueue: string[];
  metadataQueue: string[];

  setRootFolder: (folder: string) => void;
  setEntries: (entries: LocalLibraryEntry[]) => void;
  addEntries: (entries: LocalLibraryEntry[]) => void;
  updateEntry: (id: string, updates: Partial<LocalLibraryEntry>) => void;
  setScanStatus: (status: LocalScanStatus) => void;
  setScanProgress: (progress: Partial<ScanProgress>) => void;
  setScanningOriginId: (id: string | null) => void;
  setDirQueue: (dirs: string[]) => void;
  appendDirQueue: (dirs: string[]) => void;
  shiftDirQueue: () => string | undefined;
  setMetadataQueue: (files: string[]) => void;
  appendMetadataQueue: (files: string[]) => void;
  shiftMetadataQueue: () => string | undefined;
  setLastScanned: (ts: number) => void;
  reset: () => void;
  getPendingDirsCount: () => number;
  getPendingMetadataCount: () => number;
};

const initialProgress: ScanProgress = { total: 0, done: 0, currentDir: "" };

export const useLocalLibraryStore = create<LocalLibraryState>()(
  persist(
    (set, get) => ({
      rootFolder: "",
      entries: [],
      scanStatus: "idle",
      scanProgress: { ...initialProgress },
      lastScanned: null,
      scanningOriginId: null,
      dirQueue: [],
      metadataQueue: [],

      setRootFolder: (rootFolder) => set({ rootFolder }),

      setEntries: (entries) => set({ entries }),

      addEntries: (entries) =>
        set((state) => ({
          entries: [...state.entries, ...entries],
        })),

      updateEntry: (id, updates) =>
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id ? { ...e, ...updates } : e
          ),
        })),

      setScanStatus: (scanStatus) => set({ scanStatus }),

      setScanProgress: (progress) =>
        set((state) => ({
          scanProgress: { ...state.scanProgress, ...progress },
        })),

      setScanningOriginId: (scanningOriginId) => set({ scanningOriginId }),

      setDirQueue: (dirs) => set({ dirQueue: dirs }),

      appendDirQueue: (dirs) =>
        set((state) => ({ dirQueue: [...state.dirQueue, ...dirs] })),

      shiftDirQueue: () => {
        const { dirQueue } = get();
        if (dirQueue.length === 0) return undefined;
        const [first, ...rest] = dirQueue;
        set({ dirQueue: rest });
        return first;
      },

      setMetadataQueue: (files) => set({ metadataQueue: files }),

      appendMetadataQueue: (files) =>
        set((state) => ({
          metadataQueue: [...state.metadataQueue, ...files],
        })),

      shiftMetadataQueue: () => {
        const { metadataQueue } = get();
        if (metadataQueue.length === 0) return undefined;
        const [first, ...rest] = metadataQueue;
        set({ metadataQueue: rest });
        return first;
      },

      setLastScanned: (lastScanned) => set({ lastScanned }),

      reset: () =>
        set({
          entries: [],
          scanStatus: "idle",
          scanProgress: { ...initialProgress },
          lastScanned: null,
          scanningOriginId: null,
          dirQueue: [],
          metadataQueue: [],
        }),

      getPendingDirsCount: () => get().dirQueue.length,
      getPendingMetadataCount: () => get().metadataQueue.length,
    }),
    {
      name: "ytmusic-local-library",
      partialize: (state) => ({
        rootFolder: state.rootFolder,
        entries: state.entries,
        scanStatus: state.scanStatus,
        scanProgress: state.scanProgress,
        lastScanned: state.lastScanned,
        dirQueue: state.dirQueue,
        metadataQueue: state.metadataQueue,
      }),
    }
  )
);

// Helpers
const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".ogg",
  ".wav",
  ".m4a",
  ".aac",
  ".wma",
  ".opus",
  ".aiff",
  ".alac",
]);

export function isAudioFile(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  return AUDIO_EXTENSIONS.has(ext);
}

export function fileIdFromPath(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `local_${Math.abs(hash).toString(36)}`;
}

export function guessMetadataFromPath(
  relativePath: string
): { artistName: string; albumName: string | null; name: string } {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  const fileName = parts.pop() || relativePath;
  const name = fileName.replace(/\.[^/.]+$/, "").trim();

  let artistName = "Unknown Artist";
  let albumName: string | null = null;

  if (parts.length >= 2) {
    artistName = parts[0];
    albumName = parts[1];
  } else if (parts.length === 1) {
    albumName = parts[0];
  }

  return { artistName, albumName, name };
}
