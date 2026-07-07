import { cachedRead, cachedExists, cachedCreateDirectory, cachedWrite, cachedReadDirectory } from "../sqlite-db/sqlite-db-cache";
import type { DirEntry } from "../platform/types";
import { joinPaths } from "../../lib/path-utils";
import { isImageFile } from "../image-preloader";

const IMAGE_PRIORITY = [
  "cover.jpg", "cover.png", "cover.webp",
  "folder.jpg", "folder.png",
  "front.jpg", "front.png",
];

export async function findBestCover(
  libraryRoot: string,
  targetAlbumDir: string,
  dbCoverRelPath: string | null,
): Promise<{ source: "img" | "db"; path: string; data: Uint8Array; mime: string } | null> {
  const imgDir = joinPaths(targetAlbumDir, ".img");
  const imgDirExists = await cachedExists(imgDir);
  if (imgDirExists) {
    try {
      const entries: DirEntry[] = await cachedReadDirectory(imgDir);
      const images = entries.filter((e) => e.isFile && isImageFile(e.name));
      if (images.length > 0) {
        images.sort((a: DirEntry, b: DirEntry) => {
          const aIdx = IMAGE_PRIORITY.indexOf(a.name.toLowerCase());
          const bIdx = IMAGE_PRIORITY.indexOf(b.name.toLowerCase());
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
          if (aIdx !== -1) return -1;
          if (bIdx !== -1) return 1;
          return a.name.localeCompare(b.name);
        });
        const best = images[0];
        const data = await cachedRead(best.path);
        if (data) {
          const mime = best.name.toLowerCase().endsWith(".png")
            ? "image/png"
            : best.name.toLowerCase().endsWith(".webp")
            ? "image/webp"
            : "image/jpeg";
          return { source: "img", path: best.path, data, mime };
        }
      }
    } catch {
    }
  }

  if (dbCoverRelPath) {
    const dbPath = joinPaths(libraryRoot, dbCoverRelPath);
    const dbExists = await cachedExists(dbPath);
    if (dbExists) {
      const data = await cachedRead(dbPath);
      if (data) {
        const mime = dbCoverRelPath.toLowerCase().endsWith(".png")
          ? "image/png"
          : dbCoverRelPath.toLowerCase().endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
        return { source: "db", path: dbPath, data, mime };
      }
    }
  }

  return null;
}

export async function writeCoverToAlbumDir(
  targetAlbumDir: string,
  cover: { data: Uint8Array; mime: string },
): Promise<boolean> {
  const coverPath = joinPaths(targetAlbumDir, "cover.jpg");
  const exists = await cachedExists(coverPath);
  if (exists) return true;

  try {
    await cachedCreateDirectory(targetAlbumDir);
    await cachedWrite(coverPath, cover.data);
    return true;
  } catch {
    return false;
  }
}

export async function getCoverForAlbum(
  libraryRoot: string,
  targetAlbumDir: string,
  dbCoverRelPath: string | null,
): Promise<{ path: string; data: Uint8Array; mime: string } | null> {
  const cover = await findBestCover(libraryRoot, targetAlbumDir, dbCoverRelPath);
  return cover ? { path: cover.path, data: cover.data, mime: cover.mime } : null;
}