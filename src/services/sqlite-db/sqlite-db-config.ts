import type { SqliteDbConfig } from "./sqlite-db-types";
import { DIR_SELFTIFY, NAME_ROOT } from "./sqlite-db-types";
import { cachedRead, cachedWrite, cachedExists, cachedCreateDirectory } from "./sqlite-db-cache";
import { joinPaths } from "../../lib/path-utils";

function configPath(libraryRoot: string): string {
  return joinPaths(libraryRoot, DIR_SELFTIFY, NAME_ROOT);
}

export function createDefaultConfig(libraryName: string): SqliteDbConfig {
  return {
    version: 1,
    libraryName,
    createdAt: Date.now(),
    lastScanAt: null,
    scanStatus: "idle",
    songCount: 0,
    artistCount: 0,
    albumCount: 0,
  };
}

export async function readConfig(
  _libraryRoot: string,
): Promise<SqliteDbConfig | null> {
  try {
    const path = configPath(_libraryRoot);
    const data = await cachedRead(path);
    if (!data) return null;
    const text = new TextDecoder().decode(data);
    return JSON.parse(text) as SqliteDbConfig;
  } catch (err) {
    console.warn("[sqlite-db-config] read error:", err);
    return null;
  }
}

export async function writeConfig(
  _libraryRoot: string,
  config: SqliteDbConfig,
): Promise<void> {
  try {
    const content = JSON.stringify(config, null, 2);
    await cachedWrite(configPath(_libraryRoot), new TextEncoder().encode(content));
  } catch (err) {
    console.error("[sqlite-db-config] write error:", err);
  }
}

export async function ensureSelftifyDir(libraryRoot: string): Promise<void> {
  const dir = joinPaths(libraryRoot, DIR_SELFTIFY);
  const exists = await cachedExists(dir);
  if (!exists) {
    await cachedCreateDirectory(dir);
  }
}

export async function readOrCreateConfig(
  libraryRoot: string,
  libraryName?: string,
): Promise<SqliteDbConfig> {
  const existing = await readConfig(libraryRoot);
  if (existing) return existing;
  const cfg = createDefaultConfig(libraryName || "My Music");
  await ensureSelftifyDir(libraryRoot);
  await writeConfig(libraryRoot, cfg);
  return cfg;
}
