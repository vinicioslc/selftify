import { describe, it, expect } from "vitest";
import { decideAutoScan } from "../auto-scan-logic";

describe("decideAutoScan", () => {
  const rootFolder = "/home/user/Music";

  it("returns 'resume' when scan was interrupted and queue is non-empty", () => {
    expect(decideAutoScan({ rootFolder, scanState: { scan_status: "scanning" }, queueCount: 5, songCount: 0 })).toBe("resume");
  });

  it("returns 'mark-done' when scan was interrupted but queue is empty", () => {
    expect(decideAutoScan({ rootFolder, scanState: { scan_status: "paused" }, queueCount: 0, songCount: 0 })).toBe("mark-done");
  });

  it("returns 'start' when scanStatus is 'done' but in-memory DB is empty (the bug scenario)", () => {
    // This test would have FAILED with the old code,
    // which only checked scanStatus === "idle"
    expect(decideAutoScan({ rootFolder, scanState: { scan_status: "done" }, queueCount: 0, songCount: 0 })).toBe("start");
  });

  it("returns 'skip' when scanStatus is 'done' and in-memory DB has songs", () => {
    expect(decideAutoScan({ rootFolder, scanState: { scan_status: "done" }, queueCount: 0, songCount: 42 })).toBe("skip");
  });

  it("returns 'start' when scanStatus is 'idle' and rootFolder is set", () => {
    expect(decideAutoScan({ rootFolder, scanState: { scan_status: "idle" }, queueCount: 0, songCount: 0 })).toBe("start");
  });

  it("returns 'skip' when scanState is null and no rootFolder", () => {
    expect(decideAutoScan({ rootFolder: "", scanState: null, queueCount: 0, songCount: 0 })).toBe("skip");
  });

  it("returns 'start' when scanState is null but rootFolder is set (fresh install)", () => {
    expect(decideAutoScan({ rootFolder, scanState: null, queueCount: 0, songCount: 0 })).toBe("start");
  });
});
