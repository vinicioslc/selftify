import type { Song, Album, AlbumArtist } from "../types/domain-types";
import { OriginType } from "../types/domain-types";

const COVER_ART_API = "https://coverartarchive.org";

export async function searchMusicBrainz(
  q: string,
  limit: number,
  originId: string,
): Promise<{ songs: Song[]; albums: Album[]; albumArtists: AlbumArtist[] }> {
  const { searchRecordings, searchReleases, searchArtists } = await import("./musicbrainz-client");
  const [rr, relR, arR] = await Promise.all([
    searchRecordings("", "", { rawQuery: q, limit }),
    searchReleases("", "", { rawQuery: q, limit: Math.min(limit, 5) }),
    searchArtists("", { rawQuery: q, limit: Math.min(limit, 5) }),
  ]);

  const songs: Song[] = (rr.recordings ?? []).map((r) => {
    const release = r.releases?.[0];
    const rgId = release?.["release-group"]?.id;
    const imageUrl = rgId ? `${COVER_ART_API}/release-group/${rgId}/front-120.jpg` : null;
    return {
      id: `mbz-rec-${r.id}`,
      originId,
      originType: OriginType.LOCAL,
      name: r.title,
      artistName: r["artist-credit"]?.[0]?.name || "Unknown Artist",
      artistId: `mbz-art-${r["artist-credit"]?.[0]?.artist?.id || ""}`,
      albumName: release?.title || undefined,
      albumId: release ? `mbz-rel-${release.id}` : undefined,
      duration: r.length ? Math.round(r.length / 1000) : null,
      imageUrl,
      mbzRecordingId: r.id,
      mbzArtistId: r["artist-credit"]?.[0]?.artist?.id,
      mbzReleaseGroupId: rgId || undefined,
      mbzAlbumId: release?.id,
    };
  });

  const albums: Album[] = (relR.releases ?? [])
    .filter((rel) => rel["cover-art-archive"]?.front === true)
    .map((rel) => {
      const rgId = rel["release-group"]?.id;
      return {
        id: `mbz-rel-${rel.id}`,
        originId,
        originType: OriginType.LOCAL,
        name: rel.title,
        albumArtistName: rel["artist-credit"]?.[0]?.name || "Unknown Artist",
        releaseYear: rel.date ? parseInt(rel.date.slice(0, 4), 10) : undefined,
        imageUrl: rgId ? `${COVER_ART_API}/release-group/${rgId}/front-250.jpg` : null,
        mbzId: rel.id,
        mbzReleaseGroupId: rgId,
      };
    });

  const albumArtists: AlbumArtist[] = (arR.artists ?? []).map((a) => ({
    id: `mbz-art-${a.id}`,
    originId,
    originType: OriginType.LOCAL,
    name: a.name,
    imageUrl: null,
    mbz: a.id,
  }));

  return { songs, albums, albumArtists };
}

export function clearImageQueue(): void {
  // No-op: images are loaded lazily by components via image-cache.ts
}
