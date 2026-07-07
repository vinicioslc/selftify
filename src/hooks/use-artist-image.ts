import { useEffect, useState, useCallback } from "react";
import { fetchImageAsBlobUrl, tagImageSource } from "../services/image-fetch";
import { findImages, recordToBlobUrl } from "../services/image-store";
import { platformFetch } from "../services/platform-fetch";
import { artistImageResolver } from "../services/artist-image/providers/artist-resolver";
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

async function resolveArtistImageRemote(mbid: string | undefined, name: string): Promise<string | null> {
  const sources: Promise<string | null>[] = [];

  if (mbid) {
    sources.push(
      queryWikidata(mbid).then(async (imageUrl) => {
        if (!imageUrl) return null;
        tagImageSource(imageUrl, { artistName: name });
        return fetchImageAsBlobUrl(imageUrl);
      }),
    );
  }

  sources.push(
    artistImageResolver.searchAll({ artist: name, musicbrainzId: mbid }).then(async (candidates) => {
      if (candidates.length === 0) return null;
      tagImageSource(candidates[0].url, { artistName: name });
      return fetchImageAsBlobUrl(candidates[0].url);
    }),
  );

  sources.push(
    queryWikipedia(name).then(async (imageUrl) => {
      if (!imageUrl) return null;
      tagImageSource(imageUrl, { artistName: name });
      return fetchImageAsBlobUrl(imageUrl);
    }),
  );

  const results = await Promise.allSettled(sources);

  for (const r of results) {
    const val = r.status === "fulfilled" ? r.value : null;
    if (val) return val;
  }

  return null;
}

export type ArtistImageSource = "local" | "remote" | null;

export function useArtistImage(mbid: string | undefined, name: string): {
  imageUrl: string | null;
  source: ArtistImageSource;
  triggerRemote: () => void;
} {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [source, setSource] = useState<ArtistImageSource>(null);
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
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
  }, [mbid, name]);

  const triggerRemote = useCallback(async () => {
    if (triggered) return;
    setTriggered(true);
    const cacheKey = mbid || name;
    const remoteUrl = await resolveArtistImageRemote(mbid, name);
    if (remoteUrl) {
      resultCache.set(cacheKey, remoteUrl);
      setImageUrl(remoteUrl);
      setSource("remote");
    }
  }, [triggered, mbid, name]);

  return { imageUrl, source, triggerRemote };
}

export function useLazyArtistImage(mbid: string | undefined, name: string): {
  imageUrl: string | null;
  source: ArtistImageSource;
  triggerRemote: () => void;
} {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [source, setSource] = useState<ArtistImageSource>(null);
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
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
  }, [mbid, name]);

  const triggerRemote = useCallback(async () => {
    if (triggered) return;
    setTriggered(true);
    const cacheKey = mbid || name;
    const remoteUrl = await resolveArtistImageRemote(mbid, name);
    if (remoteUrl) {
      resultCache.set(cacheKey, remoteUrl);
      setImageUrl(remoteUrl);
      setSource("remote");
    }
  }, [triggered, mbid, name]);

  return { imageUrl, source, triggerRemote };
}
