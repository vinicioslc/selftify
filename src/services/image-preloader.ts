import type { PlatformService } from "./platform/types";
import { storeImage as indexDbStoreImage, md5Hash, findImages, updateImageMeta as indexDbUpdateImageMeta } from "./image-store";
import { getPlatformService } from "./platform/factory";
import { getArtistsFromSongs, getAlbumsFromSongs, getSongsByAlbum } from "../api/local/local-queries";
import { joinPaths } from "../lib/path-utils";
import { sanitizeForPath } from "./organizer/sanitizer";

export const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const BATCH_SIZE = 5;
const COVER_SIZE = 1024;

export function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  for (const ext of IMG_EXTS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function resizeImageForCover(blob: Blob): Promise<{ arrayBuffer: ArrayBuffer; blob: Blob }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const targetSize = Math.min(COVER_SIZE, side);
      const canvas = document.createElement("canvas");
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas context unavailable")); return; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);
      canvas.toBlob((resized) => {
        if (!resized) { reject(new Error("Failed to encode resized image")); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ arrayBuffer: reader.result as ArrayBuffer, blob: resized });
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(resized);
      }, "image/jpeg", 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to decode image")); };
    img.src = url;
  });
}

async function findFirstImageInDir(
  p: PlatformService,
  dirPath: string,
): Promise<{ name: string; path: string } | null> {
  try {
    const entries = await p.readDirectory(dirPath);
    const images = entries.filter((e) => e.isFile && isImageFile(e.name));
    if (images.length === 0) return null;
    images.sort((a, b) => a.name.localeCompare(b.name));
    return images[0];
  } catch {
    return null;
  }
}

const storeImageViaPlatform = indexDbStoreImage;

async function preloadArtistImage(
  p: PlatformService,
  folderPath: string,
  artistName: string,
): Promise<void> {
  try {
    const artistDir = sanitizeForPath(artistName);
    const imgDirPath = joinPaths(folderPath, artistDir, ".img");
    const found = await findFirstImageInDir(p, imgDirPath);
    if (!found) return;

    const artistNorm = artistName.toLowerCase().trim();
    const existing = await findImages({ artistName: artistNorm });
    if (existing.some((r) => !r.albumName)) return;

    const raw = await p.readFile(found.path);
    if (!raw) return;

    const blob = new Blob([raw] as BlobPart[]);
    const arrayBuffer = await blob.arrayBuffer();
    const hash = await md5Hash(arrayBuffer);

    await storeImageViaPlatform({
      md5: hash,
      blob: arrayBuffer,
      format: found.name.endsWith(".png") ? "image/png" : found.name.endsWith(".webp") ? "image/webp" : "image/jpeg",
      size: arrayBuffer.byteLength,
      createdAt: Date.now(),
      artistName: artistNorm,
      sourceUrl: found.path,
    });
  } catch (err) {
    console.warn(`[image-preloader] failed to preload artist image for "${artistName}":`, err);
  }
}

async function preloadAlbumImage(
  p: PlatformService,
  folderPath: string,
  artistName: string,
  albumName: string,
  releaseYear?: number | null,
): Promise<void> {
  try {
    let albumDirResolved: string | null = null;
    try {
      const { getAlbumDir } = await import("../api/local/local-queries");
      albumDirResolved = await getAlbumDir(artistName, albumName);
    } catch {}
    if (!albumDirResolved) {
      const artistDir = sanitizeForPath(artistName);
      const albumDirBase = sanitizeForPath(albumName);
      const albumDir = releaseYear ? `${albumDirBase} (${releaseYear})` : albumDirBase;
      albumDirResolved = joinPaths(folderPath, artistDir, albumDir);
    }
    const imgDirPath = joinPaths(albumDirResolved, ".img");
    const found = await findFirstImageInDir(p, imgDirPath);
    if (!found) return;

    const existing = await findImages({
      artistName: artistName.toLowerCase().trim(),
      albumName: albumName.toLowerCase().trim(),
    });
    if (existing.length > 0) return;

    const raw = await p.readFile(found.path);
    if (!raw) return;

    const blob = new Blob([raw] as BlobPart[]);
    const resized = await resizeImageForCover(blob);
    const hash = await md5Hash(resized.arrayBuffer);

    await storeImageViaPlatform({
      md5: hash,
      blob: resized.arrayBuffer,
      format: "image/jpeg",
      size: resized.arrayBuffer.byteLength,
      createdAt: Date.now(),
      artistName: artistName.toLowerCase().trim(),
      albumName: albumName.toLowerCase().trim(),
      sourceUrl: found.path,
    });

    // Enrich with MusicBrainz IDs from songs in this album
    try {
        const songs = await getSongsByAlbum(artistName, albumName);
        if (songs.length > 0) {
          const meta: Parameters<typeof indexDbUpdateImageMeta>[1] = {
            mbzArtistId: undefined,
            mbzReleaseGroupId: undefined,
            mbzReleaseId: undefined,
          };
          await indexDbUpdateImageMeta(hash, meta);
        }
    } catch {
      // non-critical — image is stored without MBZ IDs
    }
  } catch (err) {
    console.warn(`[image-preloader] failed to preload album image for "${artistName} — ${albumName}":`, err);
  }
}

export async function preloadImagesFromDotImg(folderPath: string): Promise<void> {
  const p = await getPlatformService();

  if (p.isWeb) {
    console.log("[image-preloader] skipped — platform is web");
    return;
  }

  console.log("[image-preloader] starting preload from .img folders...");

  try {
    const artists = await getArtistsFromSongs();
    console.log(`[image-preloader] processing ${artists.length} artists...`);
    for (let i = 0; i < artists.length; i += BATCH_SIZE) {
      const batch = artists.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((a) => preloadArtistImage(p, folderPath, a)));
    }
  } catch (err) {
    console.warn("[image-preloader] artist preload failed:", err);
  }

  try {
    const albums = await getAlbumsFromSongs();
    console.log(`[image-preloader] processing ${albums.length} albums...`);
    for (let i = 0; i < albums.length; i += BATCH_SIZE) {
      const batch = albums.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((a) => preloadAlbumImage(p, folderPath, a.artistName, a.name, a.releaseYear)));
    }
  } catch (err) {
    console.warn("[image-preloader] album preload failed:", err);
  }

  console.log("[image-preloader] preload complete");
}
