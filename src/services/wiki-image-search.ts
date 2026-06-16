import { platformFetch } from "./platform-fetch";

const WIKI_API = "https://en.wikipedia.org/w/api.php";

type WikiPageResult = {
  query?: {
    pages?: Record<string, {
      missing?: boolean;
      thumbnail?: { source: string; width: number; height: number };
    }>;
  };
};

export async function searchWikipedia(query: string, logSource: string): Promise<string | null> {
  const electronApi = (window as any).electronApi;
  if (electronApi?.wikiSearch) {
    console.log(`[${logSource}] using Electron IPC for Wikipedia search:`, query);
    try {
      const sourceUrl = await electronApi.wikiSearch(query);
      console.log(`[${logSource}] Wikipedia IPC result:`, sourceUrl ?? "null");
      return sourceUrl;
    } catch (err) {
      console.warn(`[${logSource}] Wikipedia IPC search failed, falling back to renderer:`, err);
    }
  }

  const url = `${WIKI_API}?action=query&titles=${encodeURIComponent(query)}&prop=pageimages&pithumbsize=500&format=json&origin=*`;
  console.log(`[${logSource}] Wikipedia search URL:`, url);
  try {
    const res = await platformFetch(url, { method: "GET" });
    if (!res.ok) {
      console.warn(`[${logSource}] Wikipedia HTTP`, res.status, "for query:", query);
      return null;
    }
    const data: WikiPageResult = await res.json();
    const page = Object.values(data?.query?.pages ?? {})[0];
    const sourceUrl = page && !page.missing ? (page.thumbnail?.source ?? null) : null;
    console.log(`[${logSource}] Wikipedia result:`, sourceUrl ? `found (${sourceUrl})` : "not found");
    return sourceUrl;
  } catch (err) {
    console.error(`[${logSource}] Wikipedia fetch error:`, err);
    return null;
  }
}

export function sanitizeForPath(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim();
}
