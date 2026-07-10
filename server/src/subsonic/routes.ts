import path from "path";
import fs from "fs";
import { Router, type Request, type Response } from "express";
import { config } from "../config";
import { subsonicAuth } from "./auth";
import { sendOk, sendError } from "./response";
import { missingParam, notFound, SubsonicError, SubsonicErrorCode } from "./errors";
import {
  getArtistsGrouped,
  getArtist,
  getAlbumList2,
  getAlbum,
  getSong,
  getSongPath,
  search3,
  getPlaylists,
  getPlaylist,
} from "../db/queries";
import { getDb } from "../db/connection";

const router = Router();
router.use(subsonicAuth);

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resolveCoverLocal(id: string): string | null {
  // id may be "ar-<artistId>" (artist) or plain album id
  const db = getDb();
  if (id.startsWith("ar-")) {
    const artistId = id.slice(3);
    const row = db.prepare(`SELECT images FROM artists WHERE id = ?`).get(artistId) as
      | { images: string }
      | undefined;
    return firstLocalImage(row?.images);
  }
  const row = db.prepare(`SELECT images FROM albums WHERE id = ?`).get(id) as
    | { images: string }
    | undefined;
  return firstLocalImage(row?.images);
}

function firstLocalImage(imagesJson?: string): string | null {
  if (!imagesJson) return null;
  try {
    const arr = JSON.parse(imagesJson);
    if (!Array.isArray(arr)) return null;
    for (const item of arr) {
      const p = item?.path || (typeof item === "string" ? item : null);
      if (p && fs.existsSync(p)) return p;
      if (item?.url && item.url.startsWith("/") && fs.existsSync(item.url)) return item.url;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ── ping ──
router.get(["/ping", "/ping.view"], (_req: Request, res: Response) => {
  sendOk(res, {}, res.locals.version);
});

// ── getMusicFolders ──
router.get(["/getMusicFolders", "/getMusicFolders.view"], (_req: Request, res: Response) => {
  sendOk(res, { musicFolders: { musicFolder: [{ id: 0, name: "Music" }] } }, res.locals.version);
});

// ── getArtists ──
router.get(["/getArtists", "/getArtists.view"], (_req: Request, res: Response) => {
  const { index } = getArtistsGrouped();
  sendOk(res, { artists: { index } }, res.locals.version);
});

// ── getArtist ──
router.get(["/getArtist", "/getArtist.view"], (req: Request, res: Response) => {
  const id = String(req.query.id || "");
  if (!id) return sendError(res, missingParam("id"), res.locals.version);
  const artist = getArtist(id);
  if (!artist) return sendError(res, notFound("Artist"), res.locals.version);
  sendOk(res, { artist: { ...artist, album: artist.albums } }, res.locals.version);
});

// ── getAlbumList2 ──
router.get(["/getAlbumList2", "/getAlbumList2.view"], (req: Request, res: Response) => {
  const type = String(req.query.type || "alphabeticalByName");
  const size = num(req.query.size, 500);
  const offset = num(req.query.offset, 0);
  const albums = getAlbumList2(type, size, offset);
  sendOk(res, { albumList2: { album: albums } }, res.locals.version);
});

// ── getAlbum ──
router.get(["/getAlbum", "/getAlbum.view"], (req: Request, res: Response) => {
  const id = String(req.query.id || "");
  if (!id) return sendError(res, missingParam("id"), res.locals.version);
  const result = getAlbum(id);
  if (!result) return sendError(res, notFound("Album"), res.locals.version);
  sendOk(res, { album: { ...result.album, song: result.songs } }, res.locals.version);
});

// ── getSong ──
router.get(["/getSong", "/getSong.view"], (req: Request, res: Response) => {
  const id = String(req.query.id || "");
  if (!id) return sendError(res, missingParam("id"), res.locals.version);
  const song = getSong(id);
  if (!song) return sendError(res, notFound("Song"), res.locals.version);
  sendOk(res, { song }, res.locals.version);
});

// ── search3 ──
router.get(["/search3", "/search3.view"], (req: Request, res: Response) => {
  const query = String(req.query.query || "");
  const artistCount = num(req.query.artistCount, 20);
  const albumCount = num(req.query.albumCount, 20);
  const songCount = num(req.query.songCount, 20);
  const result = search3(query, artistCount, albumCount, songCount);
  sendOk(
    res,
    { searchResult3: { artist: result.artist, album: result.album, song: result.song } },
    res.locals.version,
  );
});

// ── getPlaylists ──
router.get(["/getPlaylists", "/getPlaylists.view"], (_req: Request, res: Response) => {
  const playlists = getPlaylists();
  sendOk(res, { playlists: { playlist: playlists } }, res.locals.version);
});

// ── getPlaylist ──
router.get(["/getPlaylist", "/getPlaylist.view"], (req: Request, res: Response) => {
  const id = String(req.query.id || "");
  if (!id) return sendError(res, missingParam("id"), res.locals.version);
  const result = getPlaylist(id);
  if (!result) return sendError(res, notFound("Playlist"), res.locals.version);
  sendOk(res, { playlist: { ...result.playlist, entry: result.songs } }, res.locals.version);
});

// ── stream / download ──
router.get(["/stream", "/stream.view", "/download", "/download.view"], (req: Request, res: Response) => {
  const id = String(req.query.id || "");
  if (!id) return sendError(res, missingParam("id"), res.locals.version);
  const relPath = getSongPath(id);
  if (!relPath) return sendError(res, notFound("Song"), res.locals.version);
  const filePath = path.join(config.libraryRoot, relPath);
  if (!fs.existsSync(filePath)) return sendError(res, notFound("Audio file"), res.locals.version);

  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  const contentType = relPath.endsWith(".flac")
    ? "audio/flac"
    : relPath.endsWith(".ogg") || relPath.endsWith(".opus")
      ? "audio/ogg"
      : relPath.endsWith(".m4a")
        ? "audio/mp4"
        : "audio/mpeg";

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", end - start + 1);
    res.setHeader("Content-Type", contentType);
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  fs.createReadStream(filePath).pipe(res);
});

// ── getCoverArt ──
router.get(["/getCoverArt", "/getCoverArt.view"], (req: Request, res: Response) => {
  const id = String(req.query.id || "");
  if (!id) return sendError(res, missingParam("id"), res.locals.version);
  const coverPath = resolveCoverLocal(id);
  if (!coverPath) return sendError(res, notFound("Cover art"), res.locals.version);
  const ext = coverPath.split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  res.setHeader("Content-Type", mime);
  fs.createReadStream(coverPath).pipe(res);
});

// ── fallback 404 para rotas /rest desconhecidas ──
router.use((req: Request, res: Response) => {
  sendError(
    res,
    new SubsonicError(SubsonicErrorCode.UNKNOWN_PARAM, `Unknown Subsonic endpoint: ${req.path}`),
    res.locals.version,
  );
});

export default router;
