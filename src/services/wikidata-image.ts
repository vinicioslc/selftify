import { fetchImageAsBlobUrl } from "./image-fetch";
import { platformFetch } from "./platform-fetch";

const SPARQL_URL = "https://query.wikidata.org/sparql";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

const mbidCache = new Map<string, string | null>();
const mbidInflight = new Map<string, Promise<string | null>>();

type SparqlBinding = {
  image?: { value: string };
};

type SparqlResponse = {
  results?: {
    bindings?: SparqlBinding[];
  };
};

type CommonsPage = {
  imageinfo?: { url: string; thumburl?: string; mime?: string; size?: number }[];
};

type CommonsResponse = {
  query?: {
    pages?: Record<string, CommonsPage>;
  };
};

function sparqlQuery(mbid: string): string {
  return `
SELECT ?image WHERE {
  ?item wdt:P434 "${mbid}" .
  OPTIONAL { ?item wdt:P18 ?image . }
}
LIMIT 1`.trim();
}

async function queryWikidataByMbid(mbid: string): Promise<string | null> {
  const cached = mbidCache.get(mbid);
  if (cached !== undefined) return cached;

  const inflight = mbidInflight.get(mbid);
  if (inflight) return inflight;

  const promise = doWikidataQuery(mbid);
  mbidInflight.set(mbid, promise);
  promise.finally(() => mbidInflight.delete(mbid));
  return promise;
}

async function doWikidataQuery(mbid: string): Promise<string | null> {
  const url = `${SPARQL_URL}?format=json&query=${encodeURIComponent(sparqlQuery(mbid))}`;
  console.log(`[wikidata] querying by MBID ${mbid}: ${url}`);
  try {
    const res = await platformFetch(url, { method: "GET" });
    if (!res.ok) {
      console.warn(`[wikidata] HTTP ${res.status} for MBID ${mbid}`);
      mbidCache.set(mbid, null);
      return null;
    }
    const data: SparqlResponse = await res.json();
    const imageName = data?.results?.bindings?.[0]?.image?.value ?? null;
    if (!imageName) {
      console.warn(`[wikidata] no P18 image found for MBID ${mbid}`);
      mbidCache.set(mbid, null);
      return null;
    }
    console.log(`[wikidata] found P18 image for MBID ${mbid}: ${imageName}`);
    mbidCache.set(mbid, imageName);
    return imageName;
  } catch (err) {
    console.warn(`[wikidata] query failed for MBID ${mbid}:`, err);
    mbidCache.set(mbid, null);
    return null;
  }
}

async function getCommonsUrl(imageName: string): Promise<string | null> {
  const titles = `File:${imageName.replace(/ /g, "_")}`;
  const url = `${COMMONS_API}?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url|mime|size&format=json&origin=*`;
  console.log(`[wikidata] fetching Commons URL for ${titles}`);
  try {
    const res = await platformFetch(url, { method: "GET" });
    if (!res.ok) {
      console.warn(`[wikidata] Commons HTTP ${res.status} for ${titles}`);
      return null;
    }
    const data: CommonsResponse = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    const imageUrl = page?.imageinfo?.[0]?.url ?? null;
    if (imageUrl) {
      console.log(`[wikidata] Commons URL: ${imageUrl}`);
    } else {
      console.warn(`[wikidata] no imageinfo in Commons response for ${titles}`);
    }
    return imageUrl;
  } catch (err) {
    console.warn(`[wikidata] Commons fetch failed for ${titles}:`, err);
    return null;
  }
}

export async function fetchArtistImageFromWikidata(
  mbid: string,
  artistName: string,
): Promise<string | null> {
  console.log(`[wikidata] resolving artist image for "${artistName}" (MBID=${mbid})`);
  try {
    const imageName = await queryWikidataByMbid(mbid);
    if (!imageName) {
      console.warn(`[wikidata] no Wikidata entry for MBID ${mbid}`);
      return null;
    }
    const imageUrl = await getCommonsUrl(imageName);
    if (!imageUrl) {
      console.warn(`[wikidata] could not resolve Commons URL for "${imageName}"`);
      return null;
    }
    const blobUrl = await fetchImageAsBlobUrl(imageUrl);
    if (blobUrl) {
      console.log(`[wikidata] blob URL created for "${artistName}": ${blobUrl.slice(0, 60)}...`);
    } else {
      console.warn(`[wikidata] fetchImageAsBlobUrl failed for "${artistName}"`);
    }
    return blobUrl;
  } catch (err) {
    console.error(`[wikidata] failed for "${artistName}" MBID ${mbid}:`, err);
    return null;
  }
}
