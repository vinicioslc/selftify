import { platformFetch } from "../platform-fetch";
import { fetchImageAsBlobUrl } from "../image-fetch";
import { useSettingsStore } from "../../stores/settings.store";

export type CoverResult = {
  provider: string;
  url: string | null;
  blobUrl?: string;
  sourceId?: string;
};

export type ResolveCoverInput = {
  releaseMbid?: string | null;
  releaseGroupMbid?: string | null;
  artist: string;
  album: string;
};

async function findCoverFromCoverArtArchive(
  releaseMbid?: string | null,
): Promise<CoverResult | null> {
  if (!releaseMbid) return null;

  const url = `https://coverartarchive.org/release/${releaseMbid}/front`;
  const blobUrl = await fetchImageAsBlobUrl(url);
  if (!blobUrl) return null;

  return {
    provider: "cover-art-archive",
    url: blobUrl,
    sourceId: releaseMbid,
  };
}

async function findCoverFromCoverArtArchiveReleaseGroup(
  releaseGroupMbid?: string | null,
): Promise<CoverResult | null> {
  if (!releaseGroupMbid) return null;

  const url = `https://coverartarchive.org/release-group/${releaseGroupMbid}/front`;
  const blobUrl = await fetchImageAsBlobUrl(url);
  if (!blobUrl) return null;

  return {
    provider: "cover-art-archive",
    url: blobUrl,
    sourceId: releaseGroupMbid,
  };
}

export async function findCoverFromItunes(
  artist: string,
  album: string,
): Promise<CoverResult | null> {
  const query = `${artist} ${album}`.trim();
  if (!query) return null;

  const params = new URLSearchParams({
    term: query,
    entity: "album",
    media: "music",
    limit: "3",
  });

  const url = `https://itunes.apple.com/search?${params}`;
  const res = await platformFetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.results?.length) return null;

  const artistLower = artist.toLowerCase();
  const albumLower = album.toLowerCase();

  const exact = data.results.find((r: any) => {
    return (
      r.artistName?.toLowerCase() === artistLower &&
      r.collectionName?.toLowerCase() === albumLower
    );
  });

  const item = exact ?? data.results[0];
  const imageUrl = (item.artworkUrl100 || "").replace("100x100bb", "600x600bb");
  const blobUrl = await fetchImageAsBlobUrl(imageUrl);
  if (!blobUrl) return null;

  return {
    provider: "itunes",
    url: blobUrl,
    sourceId: String(item.collectionId),
  };
}

export async function findCoverFromDeezer(
  artist: string,
  album: string,
): Promise<CoverResult | null> {
  const query = encodeURIComponent(`${artist} ${album}`);
  const url = `https://api.deezer.com/search/album?q=${query}`;

  const res = await platformFetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.data?.length) return null;

  const artistLower = artist.toLowerCase();
  const albumLower = album.toLowerCase();

  const exact = data.data.find((item: any) => {
    return (
      item.artist?.name?.toLowerCase() === artistLower &&
      item.title?.toLowerCase() === albumLower
    );
  });

  const item = exact ?? data.data[0];
  const imageUrl = item.cover_xl ?? item.cover_big ?? item.cover_medium ?? item.cover;
  if (!imageUrl) return null;

  const blobUrl = await fetchImageAsBlobUrl(imageUrl);
  if (!blobUrl) return null;

  return {
    provider: "deezer",
    url: blobUrl,
    sourceId: String(item.id),
  };
}

export async function resolveAlbumCover(
  input: ResolveCoverInput,
): Promise<CoverResult> {
  // 0. Try local embedded covers first (SQLite)
  try {
    const { initDatabase, isReady } = await import("../../services/db/database");
    const { findAlbumByName } = await import("../../services/db/repositories/album-repo");
    const { sqliteDbImageToObjectUrl } = await import("../sqlite-db/sqlite-db-image");
    const { useAuthStore } = await import("../../stores/auth.store");
    const { OriginType } = await import("../../types/domain-types");
    const root = useAuthStore.getState().origins.find((o: any) => o.type === OriginType.LOCAL)?.folderPath;
    if (root) {
      if (!isReady()) await initDatabase(root);
      const meta = findAlbumByName(input.artist, input.album);
      if (meta?.images?.[0]?.url) {
        const imgUrl = await sqliteDbImageToObjectUrl(root, meta.images[0].url);
        if (imgUrl) return { provider: "local-embedded", url: imgUrl };
      }
    }
  } catch {
    // SQLite not available
  }

  const isEnabled = (name: string) => useSettingsStore.getState().isArtworkProviderEnabled(name);

  type ProviderDef = { name: string; fn: () => Promise<CoverResult | null> };
  const allProviders: ProviderDef[] = [
    { name: "cover_art_archive", fn: () => findCoverFromCoverArtArchive(input.releaseMbid) },
    { name: "cover_art_archive", fn: () => findCoverFromCoverArtArchiveReleaseGroup(input.releaseGroupMbid) },
    { name: "itunes", fn: () => findCoverFromItunes(input.artist, input.album) },
    { name: "deezer", fn: () => findCoverFromDeezer(input.artist, input.album) },
  ];

  const providers = allProviders.filter((p) => isEnabled(p.name));

  for (const { fn } of providers) {
    try {
      const result = await fn();
      if (result?.url) {
        return result;
      }
    } catch (error) {
      console.warn("[resolve-cover] provider failed:", error);
    }
  }

  return { provider: "fallback", url: null };
}
