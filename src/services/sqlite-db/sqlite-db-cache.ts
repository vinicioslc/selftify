import { getPlatformService } from "../platform/factory";
import type { DirEntry } from "../platform/types";
import { joinPaths } from "../../lib/path-utils";

function assertStringPath(path: string, label: string): asserts path is string {
  if (typeof path !== "string") {
    console.error(`[sqlite-db-cache] ${label} expected string, got ${typeof path}:`, path);
    throw new TypeError(`${label}: path must be a string`);
  }
}

const TTL_READ = 30_000;
const TTL_EXISTS = 30_000;
const TTL_STATS = 30_000;
const TTL_DIR = 300_000;
const LOCK_TTL = 30 * 60 * 1000;
const LOCK_NAME = "scan.lock";

interface CacheEntry {
  data: unknown;
  storedAt: number;
}

const store = new Map<string, CacheEntry>();

function get(key: string, ttl: number): unknown | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > ttl) {
    store.delete(key);
    return undefined;
  }
  return entry.data;
}

function set(key: string, data: unknown): void {
  store.set(key, { data, storedAt: Date.now() });
}

export function clearCache(): void {
  store.clear();
}

function lockPath(libraryRoot: string): string {
  return joinPaths(libraryRoot, '.selftify', LOCK_NAME);
}

export async function acquireScanLock(libraryRoot: string): Promise<boolean> {
  try {
    const p = await getPlatformService();
    const path = lockPath(libraryRoot);
    const exists = await p.fileExists(path);
    if (exists) {
      const raw = await p.readFile(path);
      if (raw) {
        const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        const text = new TextDecoder().decode(data);
        const lock = JSON.parse(text) as { acquiredAt: number };
        if (Date.now() - lock.acquiredAt < LOCK_TTL) {
          return false;
        }
      }
      await p.deleteFile(path);
    }
    const content = JSON.stringify({ acquiredAt: Date.now() });
    await p.writeFile(path, new TextEncoder().encode(content));
    return true;
  } catch {
    return false;
  }
}

export async function releaseScanLock(libraryRoot: string): Promise<void> {
  try {
    const p = await getPlatformService();
    await p.deleteFile(lockPath(libraryRoot));
  } catch {
    // best effort
  }
}

function guardString(v: unknown, label: string): string {
  if (typeof v !== "string") {
    console.error(`[sqlite-db-cache] ${label}: expected string, got ${typeof v}`, v);
    return "";
  }
  return v;
}

export async function cachedRead(fullPath: string): Promise<Uint8Array | null> {
  fullPath = guardString(fullPath, "cachedRead");
  if (!fullPath) return null;
  const cached = get(fullPath, TTL_READ);
  if (cached !== undefined) {
    if (cached === null) return null;
    if (cached instanceof Uint8Array) return cached;
    if (Array.isArray(cached)) return new Uint8Array(cached);
    return null;
  }
  const p = await getPlatformService();
  const data = await p.readFile(fullPath);
  const normalized = data instanceof Uint8Array ? data : (data ? new Uint8Array(data) : null);
  set(fullPath, normalized);
  return normalized;
}

export async function cachedWrite(fullPath: string, data: Uint8Array): Promise<void> {
  fullPath = guardString(fullPath, "cachedWrite");
  if (!fullPath) return;
  const p = await getPlatformService();
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  const dirExists = await p.fileExists(dir);
  if (!dirExists) {
    await p.createDirectory(dir);
  }
  const tmpPath = fullPath + ".tmp";
  const wrote = await p.writeFile(tmpPath, data);
  if (!wrote) {
    console.warn("[sqlite-db-cache] write failed, skipping rename:", fullPath);
    return;
  }
  await p.renameFile(tmpPath, fullPath);
  store.delete(fullPath);
}

export async function cachedDelete(fullPath: string): Promise<void> {
  fullPath = guardString(fullPath, "cachedDelete");
  if (!fullPath) return;
  const p = await getPlatformService();
  await p.deleteFile(fullPath);
  store.delete(fullPath);
}

export async function cachedExists(fullPath: string): Promise<boolean> {
  fullPath = guardString(fullPath, "cachedExists");
  if (!fullPath) return false;
  const cached = get(fullPath, TTL_EXISTS);
  if (cached !== undefined) return cached as boolean;
  const p = await getPlatformService();
  const result = await p.fileExists(fullPath);
  set(fullPath, result);
  return result;
}

export async function cachedReadDirectory(fullPath: string): Promise<DirEntry[]> {
  fullPath = guardString(fullPath, "cachedReadDirectory");
  if (!fullPath) return [];
  const cached = get(fullPath, TTL_DIR);
  if (cached !== undefined) return cached as DirEntry[];
  const p = await getPlatformService();
  const entries = await p.readDirectory(fullPath);
  set(fullPath, entries);
  return entries;
}

export async function cachedCreateDirectory(fullPath: string): Promise<void> {
  fullPath = guardString(fullPath, "cachedCreateDirectory");
  if (!fullPath) return;
  const p = await getPlatformService();
  const exists = await p.fileExists(fullPath);
  if (!exists) {
    await p.createDirectory(fullPath);
  }
  store.delete(fullPath);
}

export async function cachedRename(oldPath: string, newPath: string): Promise<void> {
  oldPath = guardString(oldPath, "cachedRename(oldPath)");
  newPath = guardString(newPath, "cachedRename(newPath)");
  if (!oldPath || !newPath) return;
  const p = await getPlatformService();
  await p.renameFile(oldPath, newPath);
  store.delete(oldPath);
  store.delete(newPath);
}

export async function cachedFileStats(fullPath: string): Promise<{ size: number; modifiedAt: number } | null> {
  fullPath = guardString(fullPath, "cachedFileStats");
  if (!fullPath) return null;
  const cached = get(fullPath, TTL_STATS);
  if (cached !== undefined) return cached as { size: number; modifiedAt: number } | null;
  const p = await getPlatformService();
  const stats = await p.getFileStats(fullPath);
  set(fullPath, stats);
  return stats;
}
