import { joinPaths } from "../../lib/path-utils";
import { DIR_SELFTIFY, DIR_IMAGES_ARTIST, DIR_IMAGES_ALBUM, DIR_IMAGES_QUERY } from "./sqlite-db-types";
import { cachedRead, cachedWrite, cachedExists } from "./sqlite-db-cache";
import { getPlatformService } from "../platform/factory";

type SqliteDbImageCategory = "artist" | "album" | "query";

function imageCategoryDir(category: SqliteDbImageCategory): string {
  switch (category) {
    case "artist": return DIR_IMAGES_ARTIST;
    case "album": return DIR_IMAGES_ALBUM;
    case "query": return DIR_IMAGES_QUERY;
  }
}

async function ensureCategoryDir(libraryRoot: string, category: SqliteDbImageCategory): Promise<string> {
  const dir = joinPaths(libraryRoot, DIR_SELFTIFY, imageCategoryDir(category));
  const p = await getPlatformService();
  const exists = await p.fileExists(dir);
  if (!exists) {
    await p.createDirectory(dir);
  }
  return dir;
}

export function imageCategoryRelativeDir(category: SqliteDbImageCategory): string {
  return `${DIR_SELFTIFY}/${imageCategoryDir(category)}`;
}

function formatToExt(format: string): string {
  return format === "image/png" ? "png" : format === "image/webp" ? "webp" : "jpg";
}

export function imageRelPath(sha256: string, format: string, category: SqliteDbImageCategory): string {
  return `${DIR_SELFTIFY}/${imageCategoryDir(category)}/${sha256}.${formatToExt(format)}`;
}

export async function saveSqliteDbImage(
  libraryRoot: string,
  category: SqliteDbImageCategory,
  sha256: string,
  data: Uint8Array,
  format: string,
): Promise<string> {
  await ensureCategoryDir(libraryRoot, category);
  const ext = format === "image/png" ? "png" : format === "image/webp" ? "webp" : "jpg";
  const relPath = `${DIR_SELFTIFY}/${imageCategoryDir(category)}/${sha256}.${ext}`;
  const fullPath = joinPaths(libraryRoot, relPath);
  const exists = await cachedExists(fullPath);
  if (!exists) {
    await cachedWrite(fullPath, data);
  }
  return relPath;
}

export async function readSqliteDbImage(
  libraryRoot: string,
  relativePath: string,
): Promise<Uint8Array | null> {
  try {
    const fullPath = joinPaths(libraryRoot, relativePath);
    return await cachedRead(fullPath);
  } catch (err) {
    console.warn("[sqlite-db-image] read error:", err);
    return null;
  }
}

export async function sqliteDbImageToObjectUrl(
  libraryRoot: string,
  relativePath: string,
): Promise<string | null> {
  const data = await readSqliteDbImage(libraryRoot, relativePath);
  if (!data) return null;
  const ext = relativePath.split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
  return URL.createObjectURL(blob);
}

export async function resolveSqliteDbImageObjectUrl(
  libraryRoot: string,
  imageUrl: string | null,
): Promise<string | null> {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const data = new Uint8Array(await blob.arrayBuffer());
      const hash = await sha256Hash(data.buffer as ArrayBuffer);
      const format = blob.type || "image/jpeg";
      const relPath = await saveSqliteDbImage(libraryRoot, "album", hash, data, format);
      return sqliteDbImageToObjectUrl(libraryRoot, relPath);
    } catch {
      return null;
    }
  }
  if (imageUrl.startsWith("blob:")) return imageUrl;
  return sqliteDbImageToObjectUrl(libraryRoot, imageUrl);
}

export async function sha256Hash(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
