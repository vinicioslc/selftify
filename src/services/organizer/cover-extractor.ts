import { cachedRead, cachedWrite, cachedExists, cachedCreateDirectory } from "../sqlite-db/sqlite-db-cache";
import { joinPaths } from "../../lib/path-utils";

export async function writeCoverToAlbumDir(
  libraryRoot: string,
  targetAlbumDir: string,
  coverRelPath: string | null,
): Promise<boolean> {
  if (!coverRelPath) return false;

  const coverPath = joinPaths(targetAlbumDir, "cover.jpg");
  const exists = await cachedExists(coverPath);
  if (exists) return true;

  const sqliteDbImagePath = joinPaths(libraryRoot, coverRelPath);
  const imageData = await cachedRead(sqliteDbImagePath);
  if (!imageData) return false;

  await cachedCreateDirectory(targetAlbumDir);
  await cachedWrite(coverPath, imageData);
  return true;
}
