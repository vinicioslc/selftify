import type { SqliteDbRankingLogEntry } from "./sqlite-db-types";
import { useAuthStore } from "../../stores/auth.store";
import { OriginType } from "../../types/domain-types";
import { initDatabase, isReady } from "../db/database";
import * as rankingRepo from "../db/repositories/ranking-repo";

function getLibraryRoot(): string | undefined {
  return useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
}

async function ensureDb(): Promise<boolean> {
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

export async function recordRanking(entry: Omit<SqliteDbRankingLogEntry, "createdAt" | "id">): Promise<void> {
  const ready = await ensureDb();
  if (!ready) return;
  rankingRepo.recordRanking(entry);
}

export async function getRecentRankings(limit = 50): Promise<SqliteDbRankingLogEntry[]> {
  const ready = await ensureDb();
  if (!ready) return [];
  return rankingRepo.getRecentRankings(limit);
}

export async function clearRankingLog(): Promise<void> {
  const ready = await ensureDb();
  if (!ready) return;
  rankingRepo.clearRankingLog();
}

export type { SqliteDbRankingLogEntry as RankingLogEntry };
