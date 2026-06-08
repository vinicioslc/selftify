import { getAlbumDir, getSongsByArtist } from "./local-database";
import { platformFetch } from "./platform-fetch";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];

/**
 * Scan the .img subdirectory inside an album's filesystem folder
 * and return a blob URL for the first image found, or null.
 *
 * Folder structure expected:
 *   {musicFolder}/{artist}/{album}/.img/{filename}.{ext}
 */
export async function loadFromAlbumDotImg(artist: string, album: string): Promise<string | null> {
  try {
    const albumDir = await getAlbumDir(artist, album);
    if (!albumDir) return null;

    const { getPlatformService } = await import("./platform/factory");
    const p = await getPlatformService();
    const imgDir = `${albumDir}/.img`;

    let entries: { name: string; path: string }[];
    try {
      entries = await p.readDirectory(imgDir);
    } catch {
      return null;
    }

    const imageFiles = entries.filter((e) => {
      const ext = e.name.toLowerCase().slice(e.name.lastIndexOf(".") + 1);
      return IMAGE_EXTS.includes(ext);
    });

    if (imageFiles.length === 0) return null;

    const imgPath = imageFiles[0].path;
    const data = await p.readFile(imgPath);
    if (!data) return null;

    const ext = imgPath.toLowerCase().slice(imgPath.lastIndexOf(".") + 1);
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn("[dot-img-loader] error:", err);
    return null;
  }
}

/**
 * Scan the .img subdirectory inside an artist's filesystem folder
 * and return a blob URL for the first image found, or null.
 *
 * Folder structure expected:
 *   {musicFolder}/{artist}/.img/{filename}.{ext}
 */
export async function loadFromArtistDotImg(artist: string): Promise<string | null> {
  try {
    const songs = await getSongsByArtist(artist);
    if (songs.length === 0 || !songs[0].path) return null;

    const firstPath = songs[0].path;
    const idx = Math.max(firstPath.lastIndexOf("/"), firstPath.lastIndexOf("\\"));
    if (idx < 0) return null;
    const albumDir = firstPath.slice(0, idx);
    const artistIdx = Math.max(albumDir.lastIndexOf("/"), albumDir.lastIndexOf("\\"));
    const artistDir = artistIdx >= 0 ? albumDir.slice(0, artistIdx) : albumDir;

    const { getPlatformService } = await import("./platform/factory");
    const p = await getPlatformService();
    const imgDir = `${artistDir}/.img`;

    let entries: { name: string; path: string }[];
    try {
      entries = await p.readDirectory(imgDir);
    } catch {
      return null;
    }

    const imageFiles = entries.filter((e) => {
      const ext = e.name.toLowerCase().slice(e.name.lastIndexOf(".") + 1);
      return IMAGE_EXTS.includes(ext);
    });

    if (imageFiles.length === 0) return null;

    const imgPath = imageFiles[0].path;
    const data = await p.readFile(imgPath);
    if (!data) return null;

    const ext = imgPath.toLowerCase().slice(imgPath.lastIndexOf(".") + 1);
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
    return URL.createObjectURL(blob);
  } catch (err) {
    console.warn("[dot-img-loader] artist image error:", err);
    return null;
  }
}
