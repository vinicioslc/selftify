import { useStatusStore } from "../stores/status.store";
import { type Album } from "../types/domain-types";
import * as albumRepo from "./db/repositories/album-repo";
import { getLibraryRoot, ensureDbWithRoot as ensureDb } from "./db/ensure-db";

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

  const dbReady = await ensureDb(root);
  if (dbReady) {
    const albumId = `${album.albumArtistName}/${album.name}`;
    albumRepo.softDeleteAlbum(albumId);
  }

  addMsg(`Album deleted: ${album.name}`, "success");
  return true;
}
