import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DownloadStatus } from "../../types/domain-types";
import type { Song, DownloadTask } from "../../types/domain-types";

const mockDownloadAudio = vi.fn();
const mockProcessCover = vi.fn();
const mockEmbedCover = vi.fn();
const mockDeleteFile = vi.fn();
const mockFileExists = vi.fn();

vi.mock("../download-platform", () => ({
  getDownloadPlatform: () => ({
    supportsAudioConversion: true,
    supportsCoverEmbedding: true,
    downloadAudio: mockDownloadAudio,
    processCover: mockProcessCover,
    embedCover: mockEmbedCover,
    deleteFile: mockDeleteFile,
    fileExists: mockFileExists,
  }),
}));

const mockSearchAndRank = vi.fn();

vi.mock("../youtube-download-service", () => ({
  searchAndRank: (...args: any[]) => mockSearchAndRank(...args),
}));

vi.mock("../../stores/auth.store", () => ({
  useAuthStore: {
    getState: () => ({
      origins: [
        { id: "origin-1", downloadFolder: "/music/downloads" },
      ],
    }),
  },
}));

import { processTask } from "../download-queue";
import { useDownloadStore } from "../../stores/download.store";

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-1",
    originId: "origin-1",
    originType: "local" as any,
    name: "Test Song",
    artistName: "Test Artist",
    albumName: "Test Album",
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

describe("processTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDownloadStore.setState({
      tasks: [],
      activeTaskId: null,
      isPanelOpen: false,
    });

    mockSearchAndRank.mockResolvedValue({ videoId: "yt-123", title: "Test Video" });
    mockDownloadAudio.mockResolvedValue("/music/downloads/artist/album/song.mp3");
    mockProcessCover.mockResolvedValue("/music/downloads/artist/album/cover.jpg");
    mockEmbedCover.mockResolvedValue(undefined);

    (window as any).electronApi = {
      imageFetch: vi.fn().mockResolvedValue({ body: [0xff, 0xd8, 0xff, 0xe0] }),
      yt: {
        getVideoInfo: vi.fn().mockResolvedValue({ thumbnail: "https://img.example.com/thumb.jpg" }),
      },
    };
  });

  afterEach(() => {
    delete (window as any).electronApi;
  });

  it("should throw if no download folder configured for origin", async () => {
    const task = makeTask({ song: makeSong({ originId: "nonexistent" }) });
    useDownloadStore.setState({ tasks: [task] });

    await expect(processTask(task)).rejects.toThrow("No download folder configured");
  });

  it("should throw if searchAndRank returns null", async () => {
    mockSearchAndRank.mockResolvedValue(null);
    const task = makeTask();
    useDownloadStore.setState({ tasks: [task] });

    await expect(processTask(task)).rejects.toThrow("No YouTube match found");
  });

  it("should run through all 5 steps successfully", async () => {
    const task = makeTask();
    useDownloadStore.setState({ tasks: [task] });

    await processTask(task);

    expect(mockSearchAndRank).toHaveBeenCalledWith(task.song);
    expect(mockDownloadAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: "yt-123",
        songName: "Test Song",
        artistName: "Test Artist",
        albumName: "Test Album",
        downloadFolder: "/music/downloads",
      }),
    );
    expect(mockProcessCover).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: "/music/downloads/artist/album",
      }),
    );
    expect(mockEmbedCover).toHaveBeenCalledWith({
      audioPath: "/music/downloads/artist/album/song.mp3",
      coverPath: "/music/downloads/artist/album/cover.jpg",
    });

    const updated = useDownloadStore.getState().tasks.find((t) => t.id === "task-1");
    expect(updated?.status).toBe(DownloadStatus.COMPLETED);
    expect(updated?.progress).toBe(100);
  });

  it("should complete without cover if resolveCoverBytes returns null", async () => {
    const task = makeTask({ song: makeSong({ imageUrl: null }) });
    useDownloadStore.setState({ tasks: [task] });

    mockProcessCover.mockResolvedValue(null);

    await processTask(task);

    const updated = useDownloadStore.getState().tasks.find((t) => t.id === "task-1");
    expect(updated?.status).toBe(DownloadStatus.COMPLETED);
    expect(mockEmbedCover).not.toHaveBeenCalled();
  });

  it("should update task status to SEARCHING in step 1", async () => {
    const task = makeTask();
    useDownloadStore.setState({ tasks: [task] });

    let statusDuringSearch: DownloadStatus | undefined;
    mockSearchAndRank.mockImplementation(async () => {
      statusDuringSearch = useDownloadStore.getState().tasks.find((t) => t.id === "task-1")?.status;
      return { videoId: "yt-123", title: "Test" };
    });

    await processTask(task);
    expect(statusDuringSearch).toBe(DownloadStatus.SEARCHING);
  });

  it("should update task status to DOWNLOADING_AUDIO in step 2", async () => {
    const task = makeTask();
    useDownloadStore.setState({ tasks: [task] });

    let statusDuringDownload: DownloadStatus | undefined;
    mockDownloadAudio.mockImplementation(async () => {
      statusDuringDownload = useDownloadStore.getState().tasks.find((t) => t.id === "task-1")?.status;
      return "/music/downloads/song.mp3";
    });

    await processTask(task);
    expect(statusDuringDownload).toBe(DownloadStatus.DOWNLOADING_AUDIO);
  });

  it("should update task with videoId after search", async () => {
    const task = makeTask();
    useDownloadStore.setState({ tasks: [task] });

    await processTask(task);

    const updated = useDownloadStore.getState().tasks.find((t) => t.id === "task-1");
    expect(updated?.videoId).toBe("yt-123");
  });

  it("should update task with audioPath after download", async () => {
    const task = makeTask();
    useDownloadStore.setState({ tasks: [task] });

    await processTask(task);

    const updated = useDownloadStore.getState().tasks.find((t) => t.id === "task-1");
    expect(updated?.audioPath).toBe("/music/downloads/artist/album/song.mp3");
  });

  it("should update task with coverPath after processing", async () => {
    const task = makeTask();
    useDownloadStore.setState({ tasks: [task] });

    await processTask(task);

    const updated = useDownloadStore.getState().tasks.find((t) => t.id === "task-1");
    expect(updated?.coverPath).toBe("/music/downloads/artist/album/cover.jpg");
  });

  it("should set completedAt timestamp on completion", async () => {
    const task = makeTask();
    useDownloadStore.setState({ tasks: [task] });

    const before = Date.now();
    await processTask(task);
    const after = Date.now();

    const updated = useDownloadStore.getState().tasks.find((t) => t.id === "task-1");
    expect(updated?.completedAt).toBeGreaterThanOrEqual(before);
    expect(updated?.completedAt).toBeLessThanOrEqual(after);
  });

  it("should still complete if cover embedding fails", async () => {
    mockEmbedCover.mockRejectedValue(new Error("ffmpeg not found"));
    const task = makeTask();
    useDownloadStore.setState({ tasks: [task] });

    await processTask(task);

    const updated = useDownloadStore.getState().tasks.find((t) => t.id === "task-1");
    expect(updated?.status).toBe(DownloadStatus.COMPLETED);
  });

  it("should pass song metadata to downloadAudio", async () => {
    const song = makeSong({
      trackNumber: 5,
      releaseYear: 2023,
      genres: ["Rock", "Alternative"],
    });
    const task = makeTask({ song });
    useDownloadStore.setState({ tasks: [task] });

    await processTask(task);

    expect(mockDownloadAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        trackNumber: 5,
        releaseYear: 2023,
        genres: ["Rock", "Alternative"],
      }),
    );
  });
});
