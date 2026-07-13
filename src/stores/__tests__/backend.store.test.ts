import { describe, it, expect, beforeEach } from "vitest";
import { useBackendStore } from "../backend.store";

describe("BackendStore — only stores server credentials (no local data)", () => {
  beforeEach(() => {
    useBackendStore.setState({ config: null, capabilities: [] });
  });

  it("should start with null config and empty capabilities", () => {
    const state = useBackendStore.getState();
    expect(state.config).toBeNull();
    expect(state.capabilities).toEqual([]);
  });

  it("should store selftify backend config", () => {
    const config = {
      type: "selftify" as const,
      url: "http://localhost:6189",
      user: "admin",
      password: "token-123",
    };
    useBackendStore.getState().setConfig(config);
    const state = useBackendStore.getState();
    expect(state.config).toEqual(config);
  });

  it("should store subsonic backend config", () => {
    const config = {
      type: "subsonic" as const,
      url: "http://navidrome:4533",
      user: "alice",
      password: "subsonic-token",
    };
    useBackendStore.getState().setConfig(config);
    const state = useBackendStore.getState();
    expect(state.config).toEqual(config);
  });

  it("should clear config and capabilities", () => {
    useBackendStore.getState().setConfig({
      type: "selftify",
      url: "http://localhost:6189",
      user: "admin",
      password: "token",
    });
    useBackendStore.getState().setCapabilities(["youtube", "scan"]);
    useBackendStore.getState().clearConfig();
    const state = useBackendStore.getState();
    expect(state.config).toBeNull();
    expect(state.capabilities).toEqual([]);
  });

  it("should store capabilities", () => {
    const caps = ["youtube", "lyrics-lrc", "download", "ranking", "organizer", "origins", "search-online", "scan", "settings"];
    useBackendStore.getState().setCapabilities(caps);
    expect(useBackendStore.getState().capabilities).toEqual(caps);
  });

  it("hasCapability should return true for present capabilities", () => {
    useBackendStore.getState().setCapabilities(["youtube", "scan"]);
    expect(useBackendStore.getState().hasCapability("youtube")).toBe(true);
    expect(useBackendStore.getState().hasCapability("scan")).toBe(true);
    expect(useBackendStore.getState().hasCapability("download")).toBe(false);
  });

  it("SELFTIFY_CAPABILITIES should be the expected list", async () => {
    const mod = await import("../backend.store");
    expect((mod as { SELFTIFY_CAPABILITIES: readonly string[] }).SELFTIFY_CAPABILITIES).toEqual([
      "youtube",
      "lyrics-lrc",
      "download",
      "ranking",
      "organizer",
      "origins",
      "search-online",
      "scan",
      "settings",
    ]);
  });

  it("persist partialize should only store config and capabilities", () => {
    // The persist middleware's partialize function selects only config + capabilities.
    // This test verifies the store shape has no other persisted data.
    const state = useBackendStore.getState();
    const keys = Object.keys(state).filter(
      (k) => typeof (state as Record<string, unknown>)[k] !== "function",
    );
    // Only non-function keys should be: config, capabilities
    expect(keys.sort()).toEqual(["capabilities", "config"]);
  });
});
