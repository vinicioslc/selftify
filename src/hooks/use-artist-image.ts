import { useEffect, useState, useCallback } from "react";
import { fetchImageAsBlobUrl, tagImageSource } from "../services/image-fetch";
import { findImages, recordToBlobUrl } from "../services/image-store";
import { useAuthStore } from "../stores/auth.store";
import { OriginType } from "../types/domain-types";
import { sqliteDbImageToObjectUrl } from "../services/sqlite-db/sqlite-db-image";

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
    const res = await fetch(url, { method: "GET" });
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
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data: any = await res.json();
    const imageName: string | null = data?.results?.bindings?.[0]?.image?.value ?? null;
    if (!imageName) return null;

    const titles = `File:${imageName.replace(/ /g, "_")}`;
    const cUrl = `${COMMONS_API}?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
    const cRes = await fetch(cUrl, { method: "GET" });
    if (!cRes.ok) return null;
    const cData: { query?: { pages?: Record<string, { imageinfo?: { url: string }[] }> } } = await cRes.json();
    const pages = cData?.query?.pages;
    if (!pages) return null;
    return Object.values(pages)[0]?.imageinfo?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

async function resolveArtistImageLocal(name: string): Promise<string | null> {
  try {
    const { loadFromArtistDotImg } = await import("../services/dot-img-loader");
    const dotImgUrl = await loadFromArtistDotImg(name);
    if (dotImgUrl) return dotImgUrl;
  } catch {}
  try {
    const root = useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
    if (root) {
      const { initDatabase, isReady } = await import("../services/db/database");
      const { findArtistByName } = await import("../services/db/repositories/artist-repo");
      if (!isReady()) await initDatabase(root).catch(() => {});
      if (isReady()) {
        const meta = findArtistByName(name);
        if (meta?.images?.[0]?.url) {
          const imgUrl = await sqliteDbImageToObjectUrl(root, meta.images[0].url);
          if (imgUrl) return imgUrl;
        }
      }
    }
  } catch {}
  try {
    const artistNorm = name.toLowerCase().trim();
    const all = await findImages({ artistName: artistNorm });
    const saved = all.find((r) => !r.albumName);
    if (saved && saved.blob.byteLength > 0) {
      return recordToBlobUrl(saved);
    }
  } catch {}
  return null;
}

export type ArtistImageSource = "local" | "backend" | null;

export function useArtistImage(mbid: string | undefined, name: string, imageUrl?: string | null): {
  imageUrl: string | null;
  source: ArtistImageSource;
} {
  const [imageUrlState, setImageUrl] = useState<string | null>(imageUrl ?? null);
  const [source, setSource] = useState<ArtistImageSource>(imageUrl ? "backend" : null);

  useEffect(() => {
    if (imageUrl) {
      setImageUrl(imageUrl);
      setSource("backend");
      return;
    }
    if (!name) { setImageUrl(null); setSource(null); return; }
    const cacheKey = mbid || name;

    const cached = resultCache.get(cacheKey);
    if (cached !== undefined) {
      if (cached) setImageUrl(cached);
      return;
    }

    setImageUrl(null);
    setSource(null);
    let cancelled = false;

    async function run() {
      const localUrl = await resolveArtistImageLocal(name);
      if (cancelled) return;
      if (localUrl) {
        resultCache.set(cacheKey, localUrl);
        setImageUrl(localUrl);
        setSource("local");
        return;
      }

      resultCache.set(cacheKey, null);
      setImageUrl(null);
      setSource(null);
    }

    run();
    return () => { cancelled = true; };
  }, [mbid, name, imageUrl]);

  return { imageUrl: imageUrlState, source };
}

export function useLazyArtistImage(mbid: string | undefined, name: string, imageUrl?: string | null): {
  imageUrl: string | null;
  source: ArtistImageSource;
} {
  const [imageUrlState, setImageUrl] = useState<string | null>(imageUrl ?? null);
  const [source, setSource] = useState<ArtistImageSource>(imageUrl ? "backend" : null);

  useEffect(() => {
    if (imageUrl) {
      setImageUrl(imageUrl);
      setSource("backend");
      return;
    }
    if (!name) { setImageUrl(null); setSource(null); return; }
    const cacheKey = mbid || name;
    const cached = resultCache.get(cacheKey);
    if (cached !== undefined) {
      if (cached) setImageUrl(cached);
      return;
    }
    setImageUrl(null);
    setSource(null);
    let cancelled = false;

    async function run() {
      const localUrl = await resolveArtistImageLocal(name);
      if (!cancelled && localUrl) {
        resultCache.set(cacheKey, localUrl);
        setImageUrl(localUrl);
        setSource("local");
      }
    }
    run();
    return () => { cancelled = true; };
  }, [mbid, name, imageUrl]);

  return { imageUrl: imageUrlState, source };
}
