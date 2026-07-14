import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config } from "../config";
import { getDb } from "../db/connection";
import { tryDeezer, tryItunes } from "./online-cover";

const CACHE_DIR_ALBUM = path.join(config.libraryRoot, ".selftify", "images", "album");
const CACHE_DIR_ARTIST = path.join(config.libraryRoot, ".selftify", "images", "artist");

const COVER_FILENAMES = [
  "cover.jpg", "cover.png", "cover.webp",
  "folder.jpg", "folder.png", "folder.webp",
  "Cover.jpg", "Cover.png",
  "AlbumArtSmall.jpg", "album.jpg", "album.png",
  "front.jpg", "front.png",
];

export type CoverResult = {
  data: Buffer;
  contentType: string;
};

export type CoverResolveOptions = {
  imageUrl?: string | null;
  videoId?: string;
};

export async function resolveCover(id: string): Promise<CoverResult | null> {
  if (id.startsWith("ar-")) return resolveArtistCover(id.slice(3));
  return resolveAlbumCover(id);
}

// ── Album cover ──

async function resolveAlbumCover(id: string): Promise<CoverResult | null> {
  const localPath = resolveCoverPathLocal(id);
  if (localPath) return readImage(localPath);

  const cachePath = cachedCoverPath(CACHE_DIR_ALBUM, id);
  if (cachePath) return readImage(cachePath);

  const info = extractAlbumInfo(id);
  if (info) {
    const online = await downloadAlbumCover(info.artist, info.album);
    if (online) {
      saveToCache(CACHE_DIR_ALBUM, id, online.data);
      return online;
    }
  }

  return null;
}

/**
 * Unified album cover resolution by artist/album name.
 * Used by both the Subsonic API and the download pipeline.
 * Chain: local fs ? cache ? online providers ? direct imageUrl ? YouTube thumbnail.
 */
export async function resolveAlbumCoverByNames(
  artistName: string,
  albumName: string,
  opts?: CoverResolveOptions,
): Promise<CoverResult | null> {
  const online = await downloadAlbumCover(artistName, albumName);
  if (online) return online;

  if (opts?.imageUrl) {
    const direct = await fetchImageUrl(opts.imageUrl);
    if (direct) return direct;
  }

  if (opts?.videoId) {
    const yt = await fetchYoutubeThumbnail(opts.videoId);
    if (yt) return yt;
  }

  return null;
}

function resolveCoverPathLocal(id: string): string | null {
  const db = getDb();

  const row = db.prepare(`SELECT images FROM albums WHERE id = ?`).get(id) as
    | { images: string }
    | undefined;
  if (row?.images) {
    const img = firstLocalImage(row.images);
    if (img) return img;
  }

  const albumDir = path.join(config.libraryRoot, id);
  if (fs.existsSync(albumDir) && fs.statSync(albumDir).isDirectory()) {
    for (const name of COVER_FILENAMES) {
      const filePath = path.join(albumDir, name);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
    }
  }

  return null;
}

function extractAlbumInfo(id: string): { artist: string; album: string } | null {
  if (id.startsWith("artist/")) {
    const db = getDb();
    const row = db.prepare(`SELECT artist_name, name FROM albums WHERE id = ?`).get(id) as
      | { artist_name: string; name: string }
      | undefined;
    if (row) return { artist: row.artist_name, album: row.name };
    return null;
  }
  if (id.includes("/")) {
    const parts = id.split("/");
    return { artist: parts[0], album: parts.slice(1).join("/") };
  }
  if (id.startsWith("al_")) {
    const db = getDb();
    const row = db.prepare(`SELECT artist_name, name FROM albums WHERE id = ?`).get(id) as
      | { artist_name: string; name: string }
      | undefined;
    if (row) return { artist: row.artist_name, album: row.name };
  }
  return null;
}

async function downloadAlbumCover(artist: string, album: string): Promise<CoverResult | null> {
  const deezerResult = await tryDeezer(artist, album);
  if (deezerResult) return deezerResult;
  return tryItunes(artist, album);
}

async function fetchImageUrl(url: string): Promise<CoverResult | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = Buffer.from(await resp.arrayBuffer());
    return { data, contentType: resp.headers.get("content-type") || "image/jpeg" };
  } catch {
    return null;
  }
}

async function fetchYoutubeThumbnail(videoId: string): Promise<CoverResult | null> {
  for (const size of ["maxresdefault", "hqdefault"]) {
    try {
      const thumbUrl = `https://img.youtube.com/vi/${videoId}/${size}.jpg`;
      const resp = await fetch(thumbUrl, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = Buffer.from(await resp.arrayBuffer());
        return { data, contentType: resp.headers.get("content-type") || "image/jpeg" };
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ── Artist cover ──

async function resolveArtistCover(artistId: string): Promise<CoverResult | null> {
  const db = getDb();
  const row = db.prepare(`SELECT images, name FROM artists WHERE id = ?`).get(artistId) as
    | { images: string; name: string }
    | undefined;
  if (!row) return null;

  const localPath = firstLocalImage(row.images);
  if (localPath) return readImage(localPath);

  const cacheKey = `ar-${artistId}`;

  const cachePath = cachedCoverPath(CACHE_DIR_ARTIST, cacheKey);
  if (cachePath) return readImage(cachePath);

  const online = await downloadArtistCover(row.name);
  if (online) {
    saveToCache(CACHE_DIR_ARTIST, cacheKey, online.data);
    return online;
  }

  return null;
}

async function downloadArtistCover(name: string): Promise<CoverResult | null> {
  return tryWikipediaArtist(name);
}

async function tryWikipediaArtist(name: string): Promise<CoverResult | null> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}&prop=pageimages&pithumbsize=250&format=json&origin=*`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = await res.json() as any;
    const pages = json?.query?.pages || {};
    const page = Object.values(pages)[0] as any;
    const thumbUrl = page?.thumbnail?.source;
    if (!thumbUrl) return null;
    const imgRes = await fetch(thumbUrl, { signal: AbortSignal.timeout(5000) });
    if (!imgRes.ok) return null;
    const data = Buffer.from(await imgRes.arrayBuffer());
    return { data, contentType: imgRes.headers.get("content-type") || "image/jpeg" };
  } catch {
    return null;
  }
}

// ── Cache helpers ──

function cachedCoverPath(cacheDir: string, id: string): string | null {
  const hash = coverIdHash(id);
  if (!fs.existsSync(cacheDir)) return null;
  for (const entry of fs.readdirSync(cacheDir)) {
    if (path.parse(entry).name === hash) return path.join(cacheDir, entry);
  }
  return null;
}

function saveToCache(cacheDir: string, id: string, data: Buffer): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  const hash = coverIdHash(id);
  fs.writeFileSync(path.join(cacheDir, `${hash}.jpg`), data);
}

function coverIdHash(id: string): string {
  return crypto.createHash("sha256").update(id).digest("hex").substring(0, 32);
}

// ── Image helpers ──

function readImage(filePath: string): CoverResult {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { data: fs.readFileSync(filePath), contentType };
}

function firstLocalImage(imagesJson?: string): string | null {
  if (!imagesJson) return null;
  try {
    const arr = JSON.parse(imagesJson);
    if (!Array.isArray(arr)) return null;
    for (const item of arr) {
      const p = item?.path || (typeof item === "string" ? item : null);
      if (p) {
        const absPath = path.isAbsolute(p) ? p : path.resolve(config.libraryRoot, p);
        if (fs.existsSync(absPath)) return absPath;
      }
      if (item?.url) {
        const absUrl = path.isAbsolute(item.url) ? item.url : path.resolve(config.libraryRoot, item.url);
        if (fs.existsSync(absUrl)) return absUrl;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}