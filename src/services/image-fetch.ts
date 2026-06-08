import { fetchImageAsBlobUrl, clearImageCaches as clearCache } from "./image-cache";
import { resolveAlbumCover } from "./artwork/resolve-cover";
import { storeImage, md5Hash, findImages, recordToBlobUrl } from "./image-store";
import { electronStoreImage, isElectronImageStore, electronFindImages, electronRecordToBlobUrl } from "./electron-image-store";
import { loadFromAlbumDotImg } from "./dot-img-loader";
import { useSettingsStore } from "../stores/settings.store";
export async function clearImageCaches(): Promise<void> {
  await clearCache();
}

export function clearImageQueue(): void {
  // No-op: rate limiter is global, not per-queue
}

async function storeRemoteImage(
  blobUrl: string,
  meta: { artistName?: string; albumName?: string; mbzArtistId?: string; mbzReleaseGroupId?: string; mbzReleaseId?: string },
): Promise<string> {
  try {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const hash = await md5Hash(arrayBuffer);
    const record = {
      md5: hash,
      blob: arrayBuffer,
      format: blob.type || "image/jpeg",
      size: arrayBuffer.byteLength,
      createdAt: Date.now(),
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
      await storeImage(record);
    }
  } catch (err) {
    console.warn("[image-fetch] storeRemoteImage failed:", err);
  }
  return blobUrl;
}

async function findInStore(
  artist?: string,
  album?: string,
  mbzReleaseGroupId?: string | null,
  mbzReleaseId?: string | null,
): Promise<string | null> {
  try {
    const isElectron = await isElectronImageStore();
    const queries: Array<Record<string, string>> = [];

    if (mbzReleaseGroupId) {
      queries.push({ mbzReleaseGroupId });
    }
    if (mbzReleaseId) {
      queries.push({ mbzReleaseId });
    }
    if (artist && album) {
      queries.push({ artistName: artist.toLowerCase().trim(), albumName: album.toLowerCase().trim() });
    }
    if (artist) {
      queries.push({ artistName: artist.toLowerCase().trim() });
    }

    for (const q of queries) {
      const results = await (isElectron ? electronFindImages(q as any) : findImages(q as any));
      if (results.length > 0) {
        return isElectron ? electronRecordToBlobUrl(results[0]) : recordToBlobUrl(results[0]);
      }
    }

    // Fallback: check .img folder on filesystem for local albums
    if (artist && album) {
      const dotImgUrl = await loadFromAlbumDotImg(artist, album);
      if (dotImgUrl) return dotImgUrl;
    }

    return null;
  } catch (err) {
    console.warn("[image-fetch] findInStore error:", err);
    return null;
  }
}

export async function fetchCoverArt(
  mbzId: string,
  type: "release" | "release-group" = "release-group",
): Promise<string | null> {
  const url = `https://coverartarchive.org/${type}/${mbzId}/front`;
  return fetchImageAsBlobUrl(url);
}

export async function fetchAlbumCover(
  releaseGroupId: string | null | undefined,
  releaseId?: string | null,
  artist?: string,
  album?: string,
): Promise<string | null> {
  const cached = await findInStore(artist, album, releaseGroupId, releaseId);
  if (cached) return cached;

  const isEnabled = (name: string) => useSettingsStore.getState().isArtworkProviderEnabled(name);

  if (releaseId && isEnabled("cover_art_archive")) {
    const url = await fetchCoverArt(releaseId, "release");
    if (url) {
      return storeRemoteImage(url, { artistName: artist, albumName: album, mbzReleaseId: releaseId });
    }
  }
  if (releaseGroupId && isEnabled("cover_art_archive")) {
    const url = await fetchCoverArt(releaseGroupId, "release-group");
    if (url) {
      return storeRemoteImage(url, { artistName: artist, albumName: album, mbzReleaseGroupId: releaseGroupId });
    }
  }
  if (artist && album) {
    const result = await resolveAlbumCover({
      releaseMbid: releaseId,
      releaseGroupMbid: releaseGroupId,
      artist,
      album,
    });
    if (result.url) {
      return storeRemoteImage(result.url, { artistName: artist, albumName: album, mbzReleaseGroupId: releaseGroupId || undefined, mbzReleaseId: releaseId || undefined });
    }
  }
  return null;
}
