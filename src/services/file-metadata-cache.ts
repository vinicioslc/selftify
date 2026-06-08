import type { FileTags } from "../types/song-dto";

const cache = new Map<string, { data: Partial<FileTags> | null; expiresAt: number }>();

export async function cachedFileTags(
  key: string,
  ttl: number,
  loader: () => Promise<Partial<FileTags> | null>,
): Promise<Partial<FileTags> | null> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.data;
  }

  const data = await loader();
  cache.set(key, { data, expiresAt: now + ttl });
  return data;
}

export function invalidateFileTags(key: string): void {
  cache.delete(key);
}

export function clearFileTagsCache(): void {
  cache.clear();
}

export function pruneExpiredFileTags(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}
