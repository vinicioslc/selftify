import type { ImageRecord } from "./image-store";
import { recordToBlobUrl as indexDbRecordToBlobUrl, getImageByMd5 as indexDbGetByMd5, getImageBySourceUrl as indexDbGetByUrl, storeImage as indexDbStore, updateImageMeta as indexDbUpdateMeta, findImages as indexDbFind } from "./image-store";
import { emitCoverUpdate } from "./cover-event-bus";

function getApi() {
  return (window as any).electronApi?.imageCache as {
    store: (hash: string, buffer: number[], format: string, meta?: Record<string, unknown>) => Promise<string>;
    get: (hash: string) => Promise<{ meta: { md5: string; format: string; size: number; createdAt: number; sourceUrl?: string; artistName?: string; albumName?: string; mbzArtistId?: string; mbzReleaseGroupId?: string; mbzReleaseId?: string }; data: number[] } | null>;
    getBySourceUrl: (url: string) => Promise<{ meta: any; data: number[] } | null>;
    find: (query: Record<string, unknown>) => Promise<any[]>;
    clear: () => Promise<void>;
  } | undefined;
}

function toBlobUrl(data: number[], format: string): string {
  const blob = new Blob([new Uint8Array(data)], { type: format });
  return URL.createObjectURL(blob);
}

function metaToRecord(meta: any): ImageRecord {
  return {
    md5: meta.md5,
    blob: new ArrayBuffer(0),
    format: meta.format,
    size: meta.size,
    createdAt: meta.createdAt,
    sourceUrl: meta.sourceUrl,
    artistName: meta.artistName,
    albumName: meta.albumName,
    mbzArtistId: meta.mbzArtistId,
    mbzReleaseGroupId: meta.mbzReleaseGroupId,
    mbzReleaseId: meta.mbzReleaseId,
  };
}

export async function isElectronImageStore(): Promise<boolean> {
  return !!(window as any).electronApi?.imageCache;
}

export async function electronStoreImage(record: ImageRecord): Promise<void> {
  const api = getApi();
  if (!api) {
    await indexDbStore(record);
    return;
  }
  const buf = Array.from(new Uint8Array(record.blob));
  await api.store(record.md5, buf, record.format, {
    sourceUrl: record.sourceUrl,
    artistName: record.artistName,
    albumName: record.albumName,
    mbzArtistId: record.mbzArtistId,
    mbzReleaseGroupId: record.mbzReleaseGroupId,
    mbzReleaseId: record.mbzReleaseId,
  });
  emitCoverUpdate(record.artistName, record.albumName, record.mbzArtistId, record.mbzReleaseGroupId, record.mbzReleaseId);
}

export async function electronGetImageByMd5(hash: string): Promise<ImageRecord | null> {
  const api = getApi();
  if (!api) {
    return indexDbGetByMd5(hash);
  }
  const result = await api.get(hash);
  if (!result) return null;
  return {
    ...metaToRecord(result.meta),
    blob: new Uint8Array(result.data).buffer,
  };
}

export async function electronGetImageBySourceUrl(url: string): Promise<ImageRecord | null> {
  const api = getApi();
  if (!api) {
    return indexDbGetByUrl(url);
  }
  const result = await api.getBySourceUrl(url);
  if (!result) return null;
  return {
    ...metaToRecord(result.meta),
    blob: new Uint8Array(result.data).buffer,
  };
}

export async function electronRecordToBlobUrl(record: ImageRecord): Promise<string> {
  if (record.blob.byteLength > 0) {
    const blob = new Blob([record.blob], { type: record.format });
    return URL.createObjectURL(blob);
  }
  if (record.md5) {
    const full = await electronGetImageByMd5(record.md5);
    if (full && full.blob.byteLength > 0) {
      const blob = new Blob([full.blob], { type: full.format });
      return URL.createObjectURL(blob);
    }
  }
  return indexDbRecordToBlobUrl(record);
}

export async function electronUpdateImageMeta(
  md5: string,
  meta: Partial<Pick<ImageRecord, "artistName" | "albumName" | "mbzArtistId" | "mbzReleaseGroupId" | "mbzReleaseId">>,
): Promise<void> {
  const api = getApi();
  if (api) {
    // Electron store stores metadata inline with the blob; re-store to update
    const existing = await api.get(md5);
    if (existing) {
      await api.store(md5, existing.data, existing.meta.format, {
        ...existing.meta,
        ...meta,
      });
    }
    return;
  }
  await indexDbUpdateMeta(md5, meta);
}

export async function electronFindImages(
  query: Partial<Pick<ImageRecord, "artistName" | "albumName" | "mbzArtistId" | "mbzReleaseGroupId" | "mbzReleaseId">>,
): Promise<ImageRecord[]> {
  const api = getApi();
  if (!api) {
    return indexDbFind(query);
  }
  const results = await api.find(query as unknown as Record<string, unknown>);
  return results.map(metaToRecord);
}

export async function electronClearImageStore(): Promise<void> {
  const api = getApi();
  if (!api) {
    const { clearImageStore } = await import("./image-store");
    await clearImageStore();
    return;
  }
  await api.clear();
}
