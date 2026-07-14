export type CoverResult = {
  data: Buffer;
  contentType: string;
};

export async function tryDeezer(artist: string, album: string): Promise<CoverResult | null> {
  try {
    const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(`${artist} ${album}`)}&limit=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = await res.json() as any;
    const items: any[] = json?.data || [];
    const match = items.find((a: any) =>
      a?.title?.toLowerCase() === album.toLowerCase() &&
      a?.artist?.name?.toLowerCase() === artist.toLowerCase()
    ) || items[0];
    if (!match) return null;
    const imgUrl = match.cover_xl || match.cover_big || match.cover_medium;
    if (!imgUrl) return null;
    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
    if (!imgRes.ok) return null;
    const data = Buffer.from(await imgRes.arrayBuffer());
    return { data, contentType: imgRes.headers.get("content-type") || "image/jpeg" };
  } catch {
    return null;
  }
}

export async function tryItunes(artist: string, album: string): Promise<CoverResult | null> {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${album}`)}&entity=album&media=music&limit=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = await res.json() as any;
    const items: any[] = json?.results || [];
    const match = items.find((a: any) =>
      a?.collectionName?.toLowerCase() === album.toLowerCase() &&
      a?.artistName?.toLowerCase() === artist.toLowerCase()
    ) || items[0];
    if (!match?.artworkUrl100) return null;
    const imgUrl = match.artworkUrl100.replace("100x100bb", "600x600bb");
    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
    if (!imgRes.ok) return null;
    const data = Buffer.from(await imgRes.arrayBuffer());
    return { data, contentType: imgRes.headers.get("content-type") || "image/jpeg" };
  } catch {
    return null;
  }
}
