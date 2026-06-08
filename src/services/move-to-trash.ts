import { getPlatformService } from "./platform/factory";
import { deleteSong } from "./local-database";
import { fileIdFromPath } from "../stores/local-library.store";
import { useStatusStore } from "../stores/status.store";
import type { Origin } from "../types/domain-types";

function addMsg(text: string, level: "info" | "success" | "warn" | "danger" = "info") {
  useStatusStore.getState().addMessage(text, level, "Library");
}

function log(msg: string) {
  console.debug(`[move-to-trash] ${msg}`);
}

/**
 * Move a local song file to the .trash folder within the library root,
 * then remove its entry from the local database.
 *
 * @param filePath Absolute path to the file
 * @param origin The local origin (provides folderPath as library root)
 * @returns true if successfully moved and deleted
 */
export async function moveSongToTrash(filePath: string, origin: Origin): Promise<boolean> {
  const p = await getPlatformService();

  const root = origin.folderPath;
  if (!root) {
    log("no folderPath on origin, cannot determine trash root");
    addMsg("Cannot delete: library root not configured", "warn");
    return false;
  }

  const trashDir = root.replace(/\/+$/, "") + "/.trash";

  // Ensure .trash directory exists
  try {
    const exists = await p.fileExists(trashDir);
    if (!exists) {
      const ok = await p.createDirectory(trashDir);
      if (!ok) {
        log("failed to create .trash directory");
        addMsg("Cannot delete: failed to create .trash folder", "danger");
        return false;
      }
    }
  } catch (err) {
    log(`error ensuring .trash dir: ${err}`);
    addMsg("Cannot delete: filesystem error", "danger");
    return false;
  }

  // Build target path inside .trash
  const fileName = filePath.split("/").pop() || filePath.split("\\").pop() || "unknown";
  const destPath = trashDir + "/" + fileName;

  // If a file with the same name already exists in .trash, append timestamp
  let finalDest = destPath;
  if (await p.fileExists(destPath)) {
    const dotIdx = fileName.lastIndexOf(".");
    const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
    const ext = dotIdx > 0 ? fileName.slice(dotIdx) : "";
    finalDest = trashDir + "/" + base + "_" + Date.now() + ext;
  }

  try {
    const moved = await p.renameFile(filePath, finalDest);
    if (!moved) {
      log(`rename/move failed for ${filePath} -> ${finalDest}`);
      addMsg("Cannot delete: file move failed", "danger");
      return false;
    }
  } catch (err) {
    log(`rename/move error: ${err}`);
    addMsg("Cannot delete: file move error", "danger");
    return false;
  }

  // Remove from local database
  try {
    const songId = fileIdFromPath(filePath);
    await deleteSong(songId);
  } catch (err) {
    log(`failed to remove song from DB: ${err}`);
    addMsg("File moved to trash but database entry could not be removed", "warn");
    return true;
  }

  addMsg(`Moved to trash: ${fileName}`, "success");
  return true;
}
