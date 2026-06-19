import { sha256Hash, imageRelPath, readSqliteDbImage } from "./sqlite-db/sqlite-db-image";
import { cacheBlobUrl } from "./image-fetch";
import { getLibraryRoot } from "./db/ensure-db";

export type ImageRecord = {
  md5: string;
  blob: ArrayBuffer;
  format: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: number;
  artistName?: string;
  albumName?: string;
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
  mbzReleaseId?: string;
  sourceUrl?: string;
};

export async function md5Hash(buffer: ArrayBuffer): Promise<string> {
  return sha256Hash(buffer);
}

export async function storeImage(record: ImageRecord): Promise<string | null> {
  let relPath: string | null = null;
  try {
    const { saveSqliteDbImage } = await import("./sqlite-db/sqlite-db-image");
    const data = new Uint8Array(record.blob);
    const category = record.albumName ? "album" as const : "artist" as const;
    const root = getLibraryRoot() || "";
    relPath = await saveSqliteDbImage(root, category, record.md5, data, record.format);

    if (record.albumName && record.artistName && root) {
      const { upsertCoverCache } = await import("./db/repositories/cover-cache-repo");
      const { ensureDbWithRoot } = await import("./db/ensure-db");
      const dbOk = await ensureDbWithRoot(root);
      if (dbOk) {
        upsertCoverCache(record.artistName, record.albumName, record.md5, record.format, record.sourceUrl);
      }
    }
  } catch {}
  cacheBlobUrl(record.sourceUrl || record.md5, recordToBlobUrl(record));
  return relPath;
}

export function recordToBlobUrl(record: ImageRecord): string {
  const blob = new Blob([record.blob], { type: record.format });
  return URL.createObjectURL(blob);
}

export async function updateImageMeta(_hash?: string, _meta?: Record<string, unknown>): Promise<void> {
  // No-op: metadata stored in SQLite, not in separate image index
}

export async function getImageByMd5(_md5?: string): Promise<ImageRecord | null> {
  return null;
}

export async function getImageBySourceUrl(_sourceUrl?: string): Promise<ImageRecord | null> {
  return null;
}

export async function findImages(query?: Record<string, string>): Promise<ImageRecord[]> {
  if (!query || !query.artistName) return [];

  try {
    const root = getLibraryRoot();
    if (!root) return [];

    const { findCoverCache } = await import("./db/repositories/cover-cache-repo");
    const { ensureDbWithRoot } = await import("./db/ensure-db");
    const dbOk = await ensureDbWithRoot(root);
    if (!dbOk) return [];

    const albumName = query.albumName || "";
    const cached = findCoverCache(query.artistName, albumName);
    if (!cached) return [];

    const relPath = imageRelPath(cached.hash, cached.format, "album");
    const data = await readSqliteDbImage(root, relPath);
    if (!data) return [];

    const record: ImageRecord = {
      md5: cached.hash,
      blob: data.buffer as ArrayBuffer,
      format: cached.format,
      size: data.byteLength,
      createdAt: cached.created_at,
      artistName: cached.artist_name,
      albumName: cached.album_name,
      sourceUrl: cached.source_url || undefined,
    };

    return [record];
  } catch {
    return [];
  }
}

export async function clearImageStore(): Promise<void> {
  // No-op: images stored in .selftify/images/ on filesystem
}

export async function checkCacheVersion(): Promise<void> {
  // No-op
}


