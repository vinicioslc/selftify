import { findImages, recordToBlobUrl, storeImage as indexDbStoreImage, md5Hash } from "./image-store";
import { loadFromAlbumDotImg } from "./dot-img-loader";
import { sqliteDbImageToObjectUrl } from "./sqlite-db/sqlite-db-image";
import { getLibraryRoot } from "./db/ensure-db";

export type CoverInput = {
  artistName?: string | null;
  albumName?: string | null;
  mbzArtistId?: string | null;
  mbzReleaseGroupId?: string | null;
  mbzReleaseId?: string | null;
  /** Backend-provided cover URL (e.g. Subsonic getCoverArt). When present, used directly. */
  imageUrl?: string | null;
};

export type CoverSource = "img-folder" | "embedded" | "deezer" | "itunes" | "local" | "remote" | "backend" | "none";

export type CoverResult = {
  source: CoverSource;
  blobUrl: string | null;
};

async function cacheToStore(
  blobUrl: string,
  meta: { artistName?: string; albumName?: string; mbzArtistId?: string; mbzReleaseGroupId?: string; mbzReleaseId?: string },
): Promise<void> {
  try {
    const resp = await fetch(blobUrl);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const hash = await md5Hash(arrayBuffer);
    const record = {
      md5: hash, blob: arrayBuffer,
      format: blob.type || "image/jpeg",
      size: arrayBuffer.byteLength, createdAt: Date.now(),
      artistName: meta.artistName?.toLowerCase().trim(),
      albumName: meta.albumName?.toLowerCase().trim(),
      mbzArtistId: meta.mbzArtistId,
      mbzReleaseGroupId: meta.mbzReleaseGroupId,
      mbzReleaseId: meta.mbzReleaseId,
      sourceUrl: blobUrl,
    };
    await indexDbStoreImage(record);
  } catch {
    // non-critical
  }
}

async function findFromStore(query: Record<string, string>): Promise<string | null> {
  const results = await findImages(query);
  if (results.length === 0) return null;
  if (results[0].blob.byteLength === 0) {
    const { getImageByMd5 } = await import("./image-store");
    const full = await getImageByMd5(results[0].md5);
    if (full && full.blob.byteLength > 0) return recordToBlobUrl(full);
    return null;
  }
  return recordToBlobUrl(results[0]);
}



async function findSqliteDbAlbumImage(artistName: string, albumName: string): Promise<string | null> {
  try {
    const root = getLibraryRoot();
    if (!root) return null;
    const { initDatabase, isReady } = await import("../services/db/database");
    const { findAlbumByName } = await import("../services/db/repositories/album-repo");
    if (!isReady()) await initDatabase(root).catch(() => {});
    if (!isReady()) return null;
    const meta = findAlbumByName(artistName, albumName);
    if (meta?.images?.[0]?.url) {
      return sqliteDbImageToObjectUrl(root, meta.images[0].url);
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveCover(input: CoverInput): Promise<CoverResult> {
  // ── Step 1: .img/ folder (filesystem) ──
  if (input.artistName && input.albumName) {
    try {
      const dotImgUrl = await loadFromAlbumDotImg(input.artistName, input.albumName);
      if (dotImgUrl) {
        cacheToStore(dotImgUrl, {
          artistName: input.artistName,
          albumName: input.albumName,
        }).catch(() => {});
        return { source: "img-folder", blobUrl: dotImgUrl };
      }
    } catch {
      // .img folder not found
    }
  }

  // ── Step 2: SQLite DB album images (.selftify/images/album/) ──
  if (input.artistName && input.albumName) {
    const sqliteDbUrl = await findSqliteDbAlbumImage(input.artistName, input.albumName);
    if (sqliteDbUrl) {
      return { source: "embedded", blobUrl: sqliteDbUrl };
    }
  }

  // ── Step 3: IndexedDB (embedded tags from scan) ──
  const artistNorm = input.artistName?.toLowerCase().trim();
  const albumNorm = input.albumName?.toLowerCase().trim();
  const queries: Array<Record<string, string>> = [];

  if (input.mbzArtistId && input.mbzReleaseGroupId) {
    queries.push({ mbzArtistId: input.mbzArtistId, mbzReleaseGroupId: input.mbzReleaseGroupId });
  }
  if (input.mbzArtistId && input.mbzReleaseId) {
    queries.push({ mbzArtistId: input.mbzArtistId, mbzReleaseId: input.mbzReleaseId });
  }
  if (artistNorm && albumNorm) {
    queries.push({ artistName: artistNorm, albumName: albumNorm });
  }
  if (artistNorm) {
    queries.push({ artistName: artistNorm });
  }
  if (input.mbzArtistId) {
    queries.push({ mbzArtistId: input.mbzArtistId });
  }

  for (const q of queries) {
    const url = await findFromStore(q);
    if (url) return { source: "embedded", blobUrl: url };
  }

  return { source: "none", blobUrl: null };
}

/**
 * Resolve cover image strictly for a specific album.
 * Never falls back to artist-only or cross-album images.
 */
export async function resolveAlbumCoverLocalOnly(input: CoverInput): Promise<CoverResult> {
  if (input.artistName && input.albumName) {
    try {
      const dotImgUrl = await loadFromAlbumDotImg(input.artistName, input.albumName);
      if (dotImgUrl) {
        cacheToStore(dotImgUrl, {
          artistName: input.artistName,
          albumName: input.albumName,
        }).catch((err) => console.warn("[cover-resolver] cacheToStore failed:", err));
        return { source: "img-folder", blobUrl: dotImgUrl };
      }
    } catch {
    }
  }

  if (input.artistName && input.albumName) {
    const sqliteDbUrl = await findSqliteDbAlbumImage(input.artistName, input.albumName);
    if (sqliteDbUrl) {
      return { source: "embedded", blobUrl: sqliteDbUrl };
    }
  }

  const artistNorm = input.artistName?.toLowerCase().trim();
  const albumNorm = input.albumName?.toLowerCase().trim();

  if (input.mbzArtistId && input.mbzReleaseGroupId) {
    const url = await findFromStore({ mbzArtistId: input.mbzArtistId, mbzReleaseGroupId: input.mbzReleaseGroupId });
    if (url) return { source: "embedded", blobUrl: url };
  }
  if (input.mbzArtistId && input.mbzReleaseId) {
    const url = await findFromStore({ mbzArtistId: input.mbzArtistId, mbzReleaseId: input.mbzReleaseId });
    if (url) return { source: "embedded", blobUrl: url };
  }
  if (artistNorm && albumNorm) {
    const url = await findFromStore({ artistName: artistNorm, albumName: albumNorm });
    if (url) return { source: "embedded", blobUrl: url };
  }

  return { source: "none", blobUrl: null };
}

export async function resolveAlbumCover(input: CoverInput): Promise<CoverResult> {
  return resolveAlbumCoverLocalOnly(input);
}
