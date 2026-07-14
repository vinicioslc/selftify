import { getPlatformService } from "./platform/factory";
import { useStatusStore } from "../stores/status.store";
import type { Origin } from "../types/domain-types";
import { joinPaths, fileNameFromPath, stripTrailingSlash, isAbsolutePath } from "../lib/path-utils";

function addMsg(text: string, level: "info" | "success" | "warn" | "danger" = "info") {
  useStatusStore.getState().addMessage(text, level, "Library");
}

function log(msg: string) {
  console.debug(`[move-to-trash] ${msg}`);
}

export async function moveSongToTrash(filePath: string, origin: Origin): Promise<boolean> {
  const root = origin.folderPath;
  if (!root) {
    log("no folderPath on origin, cannot determine trash root");
    addMsg("Cannot delete: library root not configured", "warn");
    return false;
  }

  const p = await getPlatformService();
  if (!p.isElectron) {
    addMsg("Trash functionality requires Electron or a backend server", "warn");
    return false;
  }

  const trashDir = joinPaths(stripTrailingSlash(root), ".trash");

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

  const fileName = fileNameFromPath(filePath);
  const destPath = joinPaths(trashDir, fileName);

  let finalDest = destPath;
  if (await p.fileExists(destPath)) {
    const dotIdx = fileName.lastIndexOf(".");
    const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
    const ext = dotIdx > 0 ? fileName.slice(dotIdx) : "";
    finalDest = joinPaths(trashDir, `${base}_${Date.now()}${ext}`);
  }

  const absPath = isAbsolutePath(filePath) ? filePath : joinPaths(root, filePath);

  const fileExists = await p.fileExists(absPath);

  if (fileExists) {
    try {
      const moved = await p.renameFile(absPath, finalDest);
      if (!moved) {
        log(`rename/move failed for ${absPath} -> ${finalDest}`);
        addMsg("Cannot delete: file move failed", "danger");
        return false;
      }
    } catch (err) {
      log(`rename/move error: ${err}`);
      addMsg("Cannot delete: file move error", "danger");
      return false;
    }
  } else {
    log(`file not found on disk, removing from DB only: ${filePath}`);
  }

  addMsg(fileExists ? `Moved to trash: ${fileName}` : `Removed from library: ${fileName}`, "success");
  return true;
}
