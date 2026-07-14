import { createRequire } from "module";

const require = createRequire(import.meta.url);
const youtubedl = require("youtube-dl-exec");

export type ResolvedPlaylistEntry = {
  videoId: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  position: number;
};

export type ResolvedPlaylist = {
  id: string;
  name: string;
  url: string;
  source: string | null;
  imageUrl: string | null;
  entries: ResolvedPlaylistEntry[];
};

export function extractSource(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");
    if (host.includes("youtube") || host.includes("youtu.be")) return "youtube";
    if (host.includes("soundcloud")) return "soundcloud";
    if (host.includes("spotify")) return "spotify";
    if (host.includes("vimeo")) return "vimeo";
    if (host.includes("twitch")) return "twitch";
    if (host.includes("dailymotion")) return "dailymotion";
    return host;
  } catch {
    return null;
  }
}

export async function resolvePlaylistUrl(url: string): Promise<ResolvedPlaylist> {
  try {
    const output: any = await youtubedl(url, {
      dumpSingleJson: true,
      flatPlaylist: true,
      noWarnings: true,
      quiet: true,
      noPlaylist: false,
    });

    const entries = output?.entries || [];
    const isSingle = !entries.length && output?.id;

    const playlistId = isSingle ? `single-${output.id}` : (output?.playlist_id || `pl-${Date.now()}`);
    const playlistName = isSingle ? output?.title || "Single Video" : (output?.playlist_title || output?.title || "Imported Playlist");
    const imageUrl = isSingle ? (output?.thumbnail || null) : (output?.playlist_thumbnail || output?.thumbnail || null);

    const resolvedEntries: ResolvedPlaylistEntry[] = [];

    if (isSingle) {
      resolvedEntries.push({
        videoId: output.id,
        title: output.title || "Unknown",
        uploader: output.uploader || output.channel || output.uploader_id || null,
        duration: output.duration ? Number(output.duration) : null,
        thumbnail: output.thumbnail || null,
        position: 1,
      });
    } else {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e?.id) continue;
        resolvedEntries.push({
          videoId: e.id,
          title: e.title || "Unknown",
          uploader: e.uploader || e.channel || e.uploader_id || null,
          duration: e.duration ? Number(e.duration) : null,
          thumbnail: e.thumbnail || null,
          position: i + 1,
        });
      }
    }

    return {
      id: playlistId,
      name: playlistName,
      url,
      source: extractSource(url),
      imageUrl,
      entries: resolvedEntries,
    };
  } catch (err) {
    throw new Error(`Failed to resolve URL: ${(err as Error).message}`);
  }
}
