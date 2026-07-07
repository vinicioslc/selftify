import { getPlatformService } from "./platform/factory";
import { useStatusStore } from "../stores/status.store";
import { type Album } from "../types/domain-types";
import { cachedDelete } from "./sqlite-db/sqlite-db-cache";
import * as albumRepo from "./db/repositories/album-repo";
import { getLibraryRoot, ensureDbWithRoot as ensureDb } from "./db/ensure-db";
import { joinPaths, fileNameFromPath, stripTrailingSlash, normalizePath } from "../lib/path-utils";

function addMsg(text: string, level: "info" | "success" | "warn" | "danger" = "info") {
  useStatusStore.getState().addMessage(text, level, "Library");
}

function log(msg: string) {
  console.debug(`[delete-album] ${msg}`);
}

export async function deleteAlbumFromLibrary(album: Album): Promise<boolean> {
  const root = getLibraryRoot();
  if (!root) {
    log("no library root");
    addMsg("Cannot delete: library not configured", "warn");
    return false;
  }

  addMsg(`Deleting ${album.name}\u2026`, "info");

  const p = await getPlatformService();

  // Ensure trash directory exists
  const trashDir = joinPaths(stripTrailingSlash(root), ".trash");
  try {
    const exists = await p.fileExists(trashDir);
    if (!exists) {
      await p.createDirectory(trashDir);
    }
  } catch (err) {
    log(`error ensuring .trash dir: ${err}`);
  }

  // 1. Get tracks from DB to know which audio files to move
  const dbReady = await ensureDb(root);
  let trackPaths: string[] = [];
  let albumDir: string | null = null;
  if (dbReady) {
    const meta = albumRepo.findAlbumByName(album.albumArtistName, album.name, true);
    if (meta) {
      trackPaths = meta.tracks.map((t) => t.path).filter(Boolean);
      // Derive album directory from the first track's actual path
      if (meta.tracks.length > 0 && meta.tracks[0].path && meta.tracks[0].path.includes("/")) {
        const parts = meta.tracks[0].path.split("/");
        albumDir = joinPaths(root, parts[0], parts[1]);
      }
    }
  }

  // Fallback: construct album dir from sanitized metadata names
  if (!albumDir) {
    const { sanitizeForPath } = await import("../services/organizer/sanitizer");
    const artistDir = sanitizeForPath(album.albumArtistName);
    const albumDirBase = sanitizeForPath(album.name);
    albumDir = album.releaseYear
      ? joinPaths(root, artistDir, `${albumDirBase} (${album.releaseYear})`)
      : joinPaths(root, artistDir, albumDirBase);
  }

  // 2. Move audio files to .trash (track.path already includes artist/album dirs)
  for (const relPath of trackPaths) {
    const fullPath = joinPaths(root, relPath);
    try {
      const exists = await p.fileExists(fullPath);
      if (!exists) continue;

      const fileName = relPath.split(/[/\\]/).pop() || "unknown";
      const destPath = joinPaths(trashDir, fileName);

      let finalDest = destPath;
      if (await p.fileExists(destPath)) {
        const dotIdx = fileName.lastIndexOf(".");
        const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
        const ext = dotIdx > 0 ? fileName.slice(dotIdx) : "";
        finalDest = joinPaths(trashDir, `${base}_${Date.now()}${ext}`);
      }

      await p.renameFile(fullPath, finalDest);
      await cachedDelete(fullPath);
      log(`moved to trash: ${fileName}`);
    } catch (err) {
      log(`error moving ${relPath}: ${err}`);
    }
  }

  // 3. Delete .img/ folder (album cover art)
  const imgDir = joinPaths(albumDir, ".img");
  try {
    const imgExists = await p.fileExists(imgDir);
    if (imgExists) {
      const entries = await p.readDirectory(imgDir);
      for (const entry of entries) {
        try {
          await p.deleteFile(entry.path);
          await cachedDelete(entry.path);
        } catch (err) {
          log(`error deleting image ${entry.name}: ${err}`);
        }
      }
      // Try to delete the empty .img directory
      try {
        await p.deleteFile(imgDir);
      } catch {
        // May not be supported on all platforms; best effort
      }
    }
  } catch (err) {
    log(`error removing .img dir: ${err}`);
  }

  // 4. Delete .selftify.json metadata file on disk
  const metaFilePath = joinPaths(albumDir, ".selftify.json");
  try {
    const metaExists = await p.fileExists(metaFilePath);
    if (metaExists) {
      await p.deleteFile(metaFilePath);
      await cachedDelete(metaFilePath);
    }
  } catch (err) {
    log(`error deleting .selftify.json: ${err}`);
  }

  // 5. Soft-delete from SQLite (keep metadata for future queries)
  if (dbReady) {
    const albumId = `${album.albumArtistName}/${album.name}`;
    albumRepo.softDeleteAlbum(albumId);
  }

  addMsg(`Album deleted: ${album.name}`, "success");
  return true;
}
