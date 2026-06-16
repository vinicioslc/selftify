import { fetchImageAsBlobUrl, tagImageSource } from "./image-fetch";

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
  return `${WIKI_API}?action=query&titles=${encodeURIComponent(artistName)}&prop=pageimages&pithumbsize=500&format=json&origin=*`;
}

async function queryWikipediaThumbnail(artistName: string): Promise<string | null> {
  const cached = wikiCache.get(artistName);
  if (cached !== undefined) {
    console.debug(`[artist-image] wiki cache for "${artistName}": ${cached || '❌ none'}`);
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
  console.debug(`[artist-image] querying Wikipedia for "${artistName}": ${apiUrl}`);
  try {
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[artist-image] Wikipedia API HTTP ${res.status} for "${artistName}"`);
      wikiCache.set(artistName, null);
      return null;
    }
    const data: WikiPageResult = await res.json();
    const page = Object.values(data?.query?.pages ?? {})[0];
    const url = page && !page.missing ? (page.thumbnail?.source ?? null) : null;
    console.debug(`[artist-image] Wikipedia result for "${artistName}": ${url || '❌ no image page'}`);
    wikiCache.set(artistName, url);
    return url;
  } catch (err) {
    console.warn("[artist-image] Wikipedia query failed for " + artistName + ":", err);
    wikiCache.set(artistName, null);
    return null;
  }
}

export async function fetchArtistImage(
  artistName: string,
  mbzArtistId?: string,
): Promise<string | null> {
  try {
    const sourceUrl = await queryWikipediaThumbnail(artistName);
    if (!sourceUrl) return null;

    const imageUrl = await fetchImageAsBlobUrl(sourceUrl);
    if (imageUrl && mbzArtistId) {
      await tagImageSource(sourceUrl, { artistName, mbzArtistId });
    }
    return imageUrl;
  } catch (err) {
    console.warn("[artist-image] fetchArtistImage failed for " + artistName + ":", err);
    return null;
  }
}
