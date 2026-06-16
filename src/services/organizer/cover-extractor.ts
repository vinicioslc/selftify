import { cachedRead, cachedWrite, cachedExists, cachedCreateDirectory } from "../sqlite-db/sqlite-db-cache";

export async function writeCoverToAlbumDir(
  libraryRoot: string,
  targetAlbumDir: string,
  coverRelPath: string | null,
): Promise<boolean> {
  if (!coverRelPath) return false;

  const coverPath = `${targetAlbumDir}/cover.jpg`;
  const exists = await cachedExists(coverPath);
  if (exists) return true;

  const sqliteDbImagePath = `${libraryRoot}/.selftify/${coverRelPath}`;
  const imageData = await cachedRead(sqliteDbImagePath);
  if (!imageData) return false;

  await cachedCreateDirectory(targetAlbumDir);
  await cachedWrite(coverPath, imageData);
  return true;
}
