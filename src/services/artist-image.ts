import { findImages, recordToBlobUrl } from "./image-store";
import { electronFindImages, electronRecordToBlobUrl, isElectronImageStore } from "./electron-image-store";
import { fetchImageAsBlobUrl } from "./image-cache";
import { fetchArtistImageFromWikidata } from "./wikidata-image";
import { platformFetch } from "./platform-fetch";

const WIKI_API = "https://en.wikipedia.org/w/api.php";

// MediaWiki API never returns 404 — always 200 with missing=true for absent pages.
// This avoids browser console noise from the REST API's 404 responses.

interface WikiPageResult {
  query?: {
    pages?: Record<string, {
      pageid?: number;
      missing?: boolean;
      title?: string;
      thumbnail?: { source: string; width: number; height: number };
    }>;
  };
}

const wikiCache = new Map<string, string | null>();
const wikiInflight = new Map<string, Promise<string | null>>();

function wikiThumbnailUrl(artistName: string): string {
  return `${WIKI_API}?action=query&titles=${encodeURIComponent(artistName)}&prop=pageimages&pithumbsize=250&format=json&origin=*`;
}

async function queryWikipediaThumbnail(artistName: string): Promise<string | null> {
  const cached = wikiCache.get(artistName);
  if (cached !== undefined) {
    console.log(`[artist-image] wiki cache for "${artistName}": ${cached || '❌ none'}`);
    return cached;
  }

  const inflight = wikiInflight.get(artistName);
  if (inflight) return inflight;

  const promise = doQuery(artistName);
  wikiInflight.set(artistName, promise);
  promise.finally(() => wikiInflight.delete(artistName));
  return promise;
}

async function doQuery(artistName: string): Promise<string | null> {
  const apiUrl = wikiThumbnailUrl(artistName);
  console.log(`[artist-image] querying Wikipedia for "${artistName}": ${apiUrl}`);
  try {
    const res = await platformFetch(apiUrl, {
      method: "GET",
    });
    if (!res.ok) {
      console.warn(`[artist-image] Wikipedia API HTTP ${res.status} for "${artistName}"`);
      wikiCache.set(artistName, null);
      return null;
    }
    const data: WikiPageResult = await res.json();
    const page = Object.values(data?.query?.pages ?? {})[0];
    const url = page && !page.missing ? (page.thumbnail?.source ?? null) : null;
    if (!url) {
      console.warn(`[artist-image] Wikipedia has no page or image for "${artistName}" (missing=${page?.missing})`);
    } else {
      console.log(`[artist-image] Wikipedia found thumbnail for "${artistName}": ${url}`);
    }
    wikiCache.set(artistName, url);
    return url;
  } catch (err) {
    console.error("[artist-image] Wikipedia query failed for " + artistName + ":", err);
    wikiCache.set(artistName, null);
    return null;
  }
}

export async function fetchArtistImage(
  artistName: string,
  mbzArtistId?: string,
): Promise<string | null> {
  // 0. Check saved image first (artist-only, skip album covers)
  try {
    const artistNorm = artistName.toLowerCase().trim();
    const isElectron = await isElectronImageStore();
    const all = isElectron
      ? await electronFindImages({ artistName: artistNorm })
      : await findImages({ artistName: artistNorm });
    const saved = all.find((r) => !r.albumName);
    if (saved && (saved.blob.byteLength > 0 || isElectron)) {
      const blobUrl = isElectron ? await electronRecordToBlobUrl(saved) : await recordToBlobUrl(saved);
      if (blobUrl) {
        console.log(`[artist-image] using saved image for "${artistName}"`);
        return blobUrl;
      }
    }
  } catch (err) {
    console.warn("[artist-image] failed to check saved image:", err);
  }

  // 1. Try Wikidata by MBID (precise, reliable)
  if (mbzArtistId) {
    const wdUrl = await fetchArtistImageFromWikidata(mbzArtistId, artistName);
    if (wdUrl) {
      console.log(`[artist-image] resolved via Wikidata for "${artistName}": ${wdUrl.slice(0, 60)}...`);
      return wdUrl;
    }
    console.warn(`[artist-image] Wikidata returned nothing for MBID ${mbzArtistId}, falling back to Wikipedia`);
  }

  // 2. Fallback: Wikipedia by name (less precise but broader coverage)
  try {
    const sourceUrl = await queryWikipediaThumbnail(artistName);
    if (!sourceUrl) {
      console.warn(`[artist-image] Wikipedia returned no thumbnail for "${artistName}"`);
      return null;
    }
    console.log(`[artist-image] Wikipedia thumbnail for "${artistName}": ${sourceUrl}`);

    const imageUrl = await fetchImageAsBlobUrl(sourceUrl);
    if (imageUrl) {
      console.log(`[artist-image] blob URL created for "${artistName}": ${imageUrl.slice(0, 60)}...`);
    } else {
      console.error(`[artist-image] fetchImageAsBlobUrl returned null for "${artistName}" — image fetch failed for URL: ${sourceUrl}`);
    }
    return imageUrl;
  } catch (err) {
    console.error("[artist-image] fetchArtistImage failed for " + artistName + ":", err);
    return null;
  }
}
