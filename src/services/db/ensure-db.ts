import { initDatabase, isReady } from "./database";
import { useAuthStore } from "../../stores/auth.store";
import { OriginType } from "../../types/domain-types";

export function getLibraryRoot(): string | undefined {
  return useAuthStore.getState().origins.find(
    (o) => o.type === OriginType.LOCAL,
  )?.folderPath;
}

export async function ensureDb(): Promise<boolean> {
  if (isReady()) return true;
  const root = getLibraryRoot();
  if (!root) return false;
  try {
    await initDatabase(root);
    return isReady();
  } catch {
    return false;
  }
}

export async function ensureDbWithRoot(root: string): Promise<boolean> {
  if (isReady()) return true;
  if (!root) return false;
  try {
    await initDatabase(root);
    return isReady();
  } catch {
    return false;
  }
}
