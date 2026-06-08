import { useEffect, useState } from "react";
import { fetchImageAsBlobUrl } from "../services/image-cache";
import { findImages, recordToBlobUrl } from "../services/image-store";
import { electronFindImages, electronRecordToBlobUrl, isElectronImageStore } from "../services/electron-image-store";
import { platformFetch } from "../services/platform-fetch";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const SPARQL_URL = "https://query.wikidata.org/sparql";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

const resultCache = new Map<string, string | null>();

interface WikiPageResult {
  query?: { pages?: Record<string, { missing?: boolean; thumbnail?: { source: string } }> };
}

async function queryWikipedia(name: string): Promise<string | null> {
  const url = `${WIKI_API}?action=query&titles=${encodeURIComponent(name)}&prop=pageimages&pithumbsize=250&format=json&origin=*`;
  try {
    const res = await platformFetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data: WikiPageResult = await res.json();
    const page = Object.values(data?.query?.pages ?? {})[0];
    return page && !page.missing ? (page.thumbnail?.source ?? null) : null;
  } catch {
    return null;
  }
}

async function queryWikidata(mbid: string): Promise<string | null> {
  const query = `SELECT ?image WHERE { ?item wdt:P434 "${mbid}" . OPTIONAL { ?item wdt:P18 ?image . } } LIMIT 1`;
  const url = `${SPARQL_URL}?format=json&query=${encodeURIComponent(query)}`;
  try {
    const res = await platformFetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data: any = await res.json();
    const imageName: string | null = data?.results?.bindings?.[0]?.image?.value ?? null;
    if (!imageName) return null;

    const titles = `File:${imageName.replace(/ /g, "_")}`;
    const cUrl = `${COMMONS_API}?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
    const cRes = await platformFetch(cUrl, { method: "GET" });
    if (!cRes.ok) return null;
    const cData: { query?: { pages?: Record<string, { imageinfo?: { url: string }[] }> } } = await cRes.json();
    const pages = cData?.query?.pages;
    if (!pages) return null;
    return Object.values(pages)[0]?.imageinfo?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

export function useArtistImage(mbid: string | undefined, name: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!name) { setUrl(null); return; }
    const cacheKey = mbid || name;

    const cached = resultCache.get(cacheKey);
    if (cached !== undefined) {
      if (cached) setUrl(cached);
      return;
    }

    setUrl(null);
    let cancelled = false;

    async function run() {
      // 0. Check saved image in store first (artist-only, skip album covers)
      try {
        const artistNorm = name.toLowerCase().trim();
        const isElectron = await isElectronImageStore();
        const all = isElectron
          ? await electronFindImages({ artistName: artistNorm })
          : await findImages({ artistName: artistNorm });
        const saved = all.find((r) => !r.albumName);
        if (saved && (saved.blob.byteLength > 0 || isElectron)) {
          const blobUrl = isElectron ? await electronRecordToBlobUrl(saved) : await recordToBlobUrl(saved);
          if (blobUrl) {
            resultCache.set(cacheKey, blobUrl);
            setUrl(blobUrl);
            return;
          }
        }
      } catch {
        // fall through to remote
      }

      const sources: Promise<string | null>[] = [];

      if (mbid) {
        sources.push(
          queryWikidata(mbid).then(async (imageUrl) => {
            if (!imageUrl) return null;
            return fetchImageAsBlobUrl(imageUrl);
          }),
        );
      }

      sources.push(
        queryWikipedia(name).then(async (imageUrl) => {
          if (!imageUrl) return null;
          return fetchImageAsBlobUrl(imageUrl);
        }),
      );

      const results = await Promise.allSettled(sources);
      if (cancelled) return;

      for (const r of results) {
        const val = r.status === "fulfilled" ? r.value : null;
        if (val) {
          resultCache.set(cacheKey, val);
          setUrl(val);
          return;
        }
      }

      resultCache.set(cacheKey, null);
      setUrl(null);
    }

    run();
    return () => { cancelled = true; };
  }, [mbid, name]);

  return url;
}
