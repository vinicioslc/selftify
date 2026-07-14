import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { type StreamResolver, type ResolveRequest, FakeStreamResolver, YtDlpStreamResolver } from "../services/stream-resolver";
import { isYtDlpAvailable } from "../services/download-service";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "selftify-strm-"));
});

afterAll(() => {
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe("StreamResolver interface contract", () => {
  it("enforces the correct method signature", () => {
    // Compile-time check: a valid resolver must have a `resolve` method
    const resolver: StreamResolver = new FakeStreamResolver(tmpDir);
    expect(resolver.resolve).toBeInstanceOf(Function);
  });
});

describe("FakeStreamResolver", () => {
  let resolver: FakeStreamResolver;
  let request: ResolveRequest;

  beforeEach(() => {
    resolver = new FakeStreamResolver(tmpDir);
    request = {
      videoId: "test-video-123",
      searchQuery: "Test Artist Test Song",
      songName: "Test Song",
      artistName: "Test Artist",
      albumName: "Test Album",
      albumArtistName: "Test Artist",
      trackNumber: 1,
      releaseYear: 2024,
      genres: ["Rock"],
      coverBytes: null,
    };
  });

  it("should return a valid file path", async () => {
    const result = await resolver.resolve(request);
    expect(result.filePath).toBeDefined();
    expect(result.filePath).toContain("Test Artist");
    expect(result.filePath).toContain("Test Album");
    expect(result.filePath).toContain("01 - Test Song.mp3");
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it("should create a real .mp3 file with content", async () => {
    const result = await resolver.resolve(request);
    const stats = fs.statSync(result.filePath);
    expect(stats.size).toBeGreaterThan(0);
    const content = fs.readFileSync(result.filePath, "utf-8");
    expect(content).toContain("FAKE STREAM");
  });

  it("should create the directory structure", async () => {
    const result = await resolver.resolve(request);
    const dir = path.dirname(result.filePath);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("should work with minimal metadata (no album, no track)", async () => {
    const minimalReq: ResolveRequest = {
      videoId: "minimal-video",
      searchQuery: "Solo Artist Track",
      songName: "Solo Track",
      artistName: "Solo Artist",
    };
    const result = await resolver.resolve(minimalReq);
    expect(fs.existsSync(result.filePath)).toBe(true);
    // Should use artist dir only since there's no album
    expect(result.filePath).toContain("Solo Artist");
  });

  it("should handle cover bytes and return coverPath", async () => {
    const coverData = Buffer.from("FAKECOVER" + "X".repeat(248), "utf-8");
    const reqWithCover: ResolveRequest = {
      ...request,
      coverBytes: Array.from(coverData),
    };
    const result = await resolver.resolve(reqWithCover);
    expect(result.coverPath).toBeDefined();
    expect(fs.existsSync(result.coverPath!)).toBe(true);
    const written = fs.readFileSync(result.coverPath!);
    expect(Buffer.from(written).equals(coverData)).toBe(true);
  });

  it("should produce different file for different artists", async () => {
    const r1 = await resolver.resolve({ ...request, artistName: "Artist A", songName: "Song A" });
    const r2 = await resolver.resolve({ ...request, artistName: "Artist B", songName: "Song B" });
    expect(r1.filePath).not.toBe(r2.filePath);
    expect(r1.filePath).toContain("Artist A");
    expect(r2.filePath).toContain("Artist B");
  });
});

describe("YtDlpStreamResolver", () => {
  it("should be constructable", () => {
    const resolver = new YtDlpStreamResolver();
    expect(resolver).toBeDefined();
    expect(resolver.resolve).toBeInstanceOf(Function);
  });

  it("isYtDlpAvailable matches the adapter's capability", () => {
    const resolver = new YtDlpStreamResolver();
    expect(resolver.isAvailable()).toBe(isYtDlpAvailable());
  });
});

describe("DownloadQueue with FakeResolver", () => {
  let resolver: FakeStreamResolver;

  beforeEach(() => {
    resolver = new FakeStreamResolver(tmpDir);
  });

  it("FakeResolver integrates with the queue's expected interface", async () => {
    const request: ResolveRequest = {
      videoId: "queue-test-video",
      searchQuery: "Queue Artist Queue Song",
      songName: "Queue Song",
      artistName: "Queue Artist",
    };
    const result = await resolver.resolve(request);
    expect(result.filePath).toBeDefined();
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(result.filePath).toContain("Queue Artist");
    expect(result.filePath).toContain("Queue Song.mp3");
    const content = fs.readFileSync(result.filePath, "utf-8");
    expect(content).toContain("FAKE STREAM");
  });
});