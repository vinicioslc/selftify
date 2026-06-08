import { findImages, recordToBlobUrl, storeImage as indexDbStoreImage, md5Hash } from "./image-store";
import { isElectronImageStore, electronFindImages, electronRecordToBlobUrl, electronStoreImage } from "./electron-image-store";
import { loadFromAlbumDotImg } from "./dot-img-loader";
import { useSettingsStore } from "../stores/settings.store";

export type CoverInput = {
  artistName?: string | null;
  albumName?: string | null;
  mbzArtistId?: string | null;
  mbzReleaseGroupId?: string | null;
  mbzReleaseId?: string | null;
};

export type CoverSource = "img-folder" | "embedded" | "deezer" | "itunes" | "none";

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
    if (await isElectronImageStore()) {
      await electronStoreImage(record);
    } else {
      await indexDbStoreImage(record);
    }
  } catch {
    // non-critical
  }
}

async function findFromStore(query: Record<string, string>): Promise<string | null> {
  const isElectron = await isElectronImageStore();
  const results = await (isElectron ? electronFindImages(query) : findImages(query));
  if (results.length === 0) return null;
  if (isElectron && results[0].blob.byteLength === 0) {
    const { electronGetImageByMd5 } = await import("./electron-image-store");
    const full = await electronGetImageByMd5(results[0].md5);
    if (full && full.blob.byteLength > 0) return electronRecordToBlobUrl(full);
    return null;
  }
  return recordToBlobUrl(results[0]);
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

  // ── Step 2: IndexedDB (embedded tags from scan) ──
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

  // ── Step 3: Deezer (remote) ──
  if (input.artistName && input.albumName && useSettingsStore.getState().isArtworkProviderEnabled("deezer")) {
    try {
      const { findCoverFromDeezer } = await import("./artwork/resolve-cover");
      const result = await findCoverFromDeezer(input.artistName, input.albumName);
      if (result?.url) {
        cacheToStore(result.url, {
          artistName: input.artistName,
          albumName: input.albumName,
        }).catch(() => {});
        return { source: "deezer", blobUrl: result.url };
      }
    } catch {
      // deezer failed
    }
  }

  // ── Step 4: iTunes (remote) ──
  if (input.artistName && input.albumName && useSettingsStore.getState().isArtworkProviderEnabled("itunes")) {
    try {
      const { findCoverFromItunes } = await import("./artwork/resolve-cover");
      const result = await findCoverFromItunes(input.artistName, input.albumName);
      if (result?.url) {
        cacheToStore(result.url, {
          artistName: input.artistName,
          albumName: input.albumName,
        }).catch(() => {});
        return { source: "itunes", blobUrl: result.url };
      }
    } catch {
      // itunes failed
    }
  }

  return { source: "none", blobUrl: null };
}

/**
 * Resolve cover image strictly for a specific album.
 * Never falls back to artist-only or cross-album images.
 */
export async function resolveAlbumCover(input: CoverInput): Promise<CoverResult> {
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

  // ── Step 2: IndexedDB — only album-specific matches ──
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

  // ── Step 3: Deezer (remote, requires both artist and album) ──
  if (input.artistName && input.albumName && useSettingsStore.getState().isArtworkProviderEnabled("deezer")) {
    try {
      const { findCoverFromDeezer } = await import("./artwork/resolve-cover");
      const result = await findCoverFromDeezer(input.artistName, input.albumName);
      if (result?.url) {
        cacheToStore(result.url, {
          artistName: input.artistName,
          albumName: input.albumName,
        }).catch(() => {});
        return { source: "deezer", blobUrl: result.url };
      }
    } catch {
      // deezer failed
    }
  }

  // ── Step 4: iTunes (remote, requires both artist and album) ──
  if (input.artistName && input.albumName && useSettingsStore.getState().isArtworkProviderEnabled("itunes")) {
    try {
      const { findCoverFromItunes } = await import("./artwork/resolve-cover");
      const result = await findCoverFromItunes(input.artistName, input.albumName);
      if (result?.url) {
        cacheToStore(result.url, {
          artistName: input.artistName,
          albumName: input.albumName,
        }).catch(() => {});
        return { source: "itunes", blobUrl: result.url };
      }
    } catch {
      // itunes failed
    }
  }

  return { source: "none", blobUrl: null };
}
