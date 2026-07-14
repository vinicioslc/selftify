// Consolidated artist-image provider for Wikipedia + Wikidata.
//
// Previously the Wikipedia-by-name logic lived in artist-image.ts and the
// Wikidata-by-MBID logic lived in wikidata-image.ts (dead code, never wired
// into the resolver). Both are merged here behind one provider. The provider
// only returns candidates; the service is responsible for fetching the blob
// and tagging its source (via tagImageSource from image-fetch).

import type { ImageProvider, ImageCandidate, ImageSearchInput, ImageFetchMeta } from "../types";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const SPARQL_URL = "https://query.wikidata.org/sparql";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

type WikiPageResult = {
  query?: {
    pages?: Record<string, {
      missing?: boolean;
      thumbnail?: { source: string; width: number; height: number };
    }>;
  };
};

type CommonsResponse = {
  query?: { pages?: Record<string, { imageinfo?: { url: string }[] }> };
};

const wikiCache = new Map<string, string | null>();
const wikiInflight = new Map<string, Promise<string | null>>();
const mbidCache = new Map<string, string | null>();
const mbidInflight = new Map<string, Promise<string | null>>();

function wikiThumbnailUrl(artistName: string): string {
  return `${WIKI_API}?action=query&titles=${encodeURIComponent(artistName)}&prop=pageimages&pithumbsize=500&format=json&origin=*`;
}

async function queryWikipedia(artistName: string): Promise<string | null> {
  const cached = wikiCache.get(artistName);
  if (cached !== undefined) return cached;
  const inflight = wikiInflight.get(artistName);
  if (inflight) return inflight;

  const promise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(wikiThumbnailUrl(artistName), { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        wikiCache.set(artistName, null);
        return null;
      }
      const data: WikiPageResult = await res.json();
      const page = Object.values(data?.query?.pages ?? {})[0];
      const url = page && !page.missing ? (page.thumbnail?.source ?? null) : null;
      wikiCache.set(artistName, url);
      return url;
    } catch {
      wikiCache.set(artistName, null);
      return null;
    }
  })();

  wikiInflight.set(artistName, promise);
  promise.finally(() => wikiInflight.delete(artistName));
  return promise;
}

function sparqlQuery(mbid: string): string {
  return `
SELECT ?image WHERE {
  ?item wdt:P434 "${mbid}" .
  OPTIONAL { ?item wdt:P18 ?image . }
}
LIMIT 1`.trim();
}

async function queryWikidata(mbid: string): Promise<string | null> {
  const cached = mbidCache.get(mbid);
  if (cached !== undefined) return cached;
  const inflight = mbidInflight.get(mbid);
  if (inflight) return inflight;

  const promise = (async (): Promise<string | null> => {
    try {
      const url = `${SPARQL_URL}?format=json&query=${encodeURIComponent(sparqlQuery(mbid))}`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        mbidCache.set(mbid, null);
        return null;
      }
      const data = await res.json();
      const imageName = data?.results?.bindings?.[0]?.image?.value ?? null;
      if (!imageName) {
        mbidCache.set(mbid, null);
        return null;
      }
      const commonsUrl = await getCommonsUrl(imageName);
      mbidCache.set(mbid, commonsUrl);
      return commonsUrl;
    } catch {
      mbidCache.set(mbid, null);
      return null;
    }
  })();

  mbidInflight.set(mbid, promise);
  promise.finally(() => mbidInflight.delete(mbid));
  return promise;
}

async function getCommonsUrl(imageName: string): Promise<string | null> {
  const titles = `File:${imageName.replace(/ /g, "_")}`;
  const url = `${COMMONS_API}?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url|mime|size&format=json&origin=*`;
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data: CommonsResponse = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    return page?.imageinfo?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

export class WikipediaProvider implements ImageProvider {
  readonly name = "wikipedia";
  readonly modes = ["artist"] as const;

  private toCandidate(url: string, meta?: ImageFetchMeta): ImageCandidate {
    return {
      provider: this.name,
      url,
      confidence: 0.9,
      isFrontCover: true,
      meta,
    };
  }

  async search(input: ImageSearchInput, _signal?: AbortSignal): Promise<ImageCandidate[]> {
    const artist = input.artist;
    const mbz = input.musicbrainzArtistId;

    try {
      if (mbz) {
        const wikidataUrl = await queryWikidata(mbz);
        if (wikidataUrl) {
          return [this.toCandidate(wikidataUrl, { artistName: artist, mbzArtistId: mbz })];
        }
      }
      const wikiUrl = await queryWikipedia(artist);
      if (wikiUrl) {
        return [this.toCandidate(wikiUrl, mbz ? { artistName: artist, mbzArtistId: mbz } : undefined)];
      }
    } catch {
      // fall through to empty
    }
    return [];
  }
}
