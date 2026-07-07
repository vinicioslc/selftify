import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, type RankingWeights } from "../settings.store";

const WEIGHT_KEYS = ["title", "artist", "album", "duration", "artistOnChannel", "channelExactMatch", "coverPenalty"] as const;
const REQUIRED_KEYS: (keyof RankingWeights)[] = [...WEIGHT_KEYS, "keywords"];

/**
 * Simulates the persist migrate function logic from settings.store.ts.
 */
function simulateMigrate(persisted: unknown): RankingWeights | undefined {
  const state = (persisted || {}) as Partial<{ rankingWeights: unknown }>;
  const defaults: RankingWeights = {
    title: 1.0, artist: 0.5, album: 1.0, duration: 0.5, artistOnChannel: 0.3, channelExactMatch: 1.0, coverPenalty: -3, keywords: [],
  };
  if (!state.rankingWeights) return undefined;
  const rw = state.rankingWeights as Record<string, unknown>;
  return {
    ...defaults,
    ...Object.fromEntries(Object.entries(rw).filter(([, v]) => v !== undefined)),
  } as RankingWeights;
}

describe("SettingsStore — rankingWeights", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      rankingWeights: {
        title: 1.0,
        artist: 0.5,
        album: 1.0,
        duration: 0.5,
        artistOnChannel: 0.3,
        channelExactMatch: 1.0,
        coverPenalty: -3,
        keywords: [],
      },
    });
  });

  it("should have all required keys in default state", () => {
    const state = useSettingsStore.getState();
    for (const key of REQUIRED_KEYS) {
      expect(state.rankingWeights).toHaveProperty(key);
    }
  });

  it("should have numeric values for all weight keys", () => {
    const state = useSettingsStore.getState();
    for (const key of WEIGHT_KEYS) {
      expect(typeof state.rankingWeights[key]).toBe("number");
      expect(Number.isFinite(state.rankingWeights[key])).toBe(true);
    }
  });

  it("should setRankingWeights and preserve all keys", () => {
    useSettingsStore.getState().setRankingWeights({
      title: 2.0,
      artist: 1.0,
      album: 1.5,
      duration: 0.8,
      artistOnChannel: 0.5,
      channelExactMatch: 1.0,
      coverPenalty: -3,
      keywords: [],
    });
    const { rankingWeights } = useSettingsStore.getState();
    expect(rankingWeights.title).toBe(2.0);
    expect(rankingWeights.artist).toBe(1.0);
    expect(rankingWeights.album).toBe(1.5);
    expect(rankingWeights.duration).toBe(0.8);
    expect(rankingWeights.artistOnChannel).toBe(0.5);
    expect(rankingWeights.channelExactMatch).toBe(1.0);
    expect(rankingWeights.coverPenalty).toBe(-3);
  });

  it("should survive setRankingWeights with partial keys (merge with defaults)", () => {
    useSettingsStore.getState().setRankingWeights({
      title: 0.0,
      artist: 0.0,
      album: 0.0,
      duration: 0.0,
      artistOnChannel: 0.0,
      channelExactMatch: 0.0,
      coverPenalty: 0.0,
      keywords: [],
    });
    const { rankingWeights } = useSettingsStore.getState();
    for (const key of REQUIRED_KEYS) {
      expect(rankingWeights).toHaveProperty(key);
    }
  });

  it("should always have a finite number safe for toFixed(1)", () => {
    const { rankingWeights } = useSettingsStore.getState();
    for (const key of WEIGHT_KEYS) {
      const val = rankingWeights[key];
      expect(val).not.toBeUndefined();
      expect(val).not.toBeNull();
      expect(typeof val).toBe("number");
      expect(Number.isFinite(val)).toBe(true);
    }
  });
});

describe("SettingsStore — migrate (rankingWeights)", () => {
  it("should fill missing keys from stored partial data", () => {
    const migrated = simulateMigrate({
      rankingWeights: { title: 0.5, artist: 0.3, keywords: [] },
    });
    expect(migrated).toBeDefined();
    expect(migrated!).toHaveProperty("album");
    expect(migrated!).toHaveProperty("duration");
    expect(migrated!).toHaveProperty("artistOnChannel");
    expect(migrated!.title).toBe(0.5);
    expect(migrated!.artist).toBe(0.3);
  });

  it("should keep every weight key as a finite number", () => {
    const migrated = simulateMigrate({
      rankingWeights: { title: 0.0, artist: 0.0, keywords: [] },
    });
    expect(migrated).toBeDefined();
    for (const key of WEIGHT_KEYS) {
      const val = migrated![key];
      expect(val).not.toBeUndefined();
      expect(val).not.toBeNull();
      expect(typeof val).toBe("number");
      expect(Number.isFinite(val)).toBe(true);
    }
  });

  it("should return undefined when rankingWeights is null in persisted state", () => {
    const migrated = simulateMigrate({ rankingWeights: null });
    expect(migrated).toBeUndefined();
  });

  it("should return undefined when rankingWeights is missing from persisted state", () => {
    const migrated = simulateMigrate({});
    expect(migrated).toBeUndefined();
  });
});
