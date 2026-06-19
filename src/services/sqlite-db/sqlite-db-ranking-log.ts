import type { SqliteDbRankingLogEntry } from "./sqlite-db-types";
import * as rankingRepo from "../db/repositories/ranking-repo";
import { ensureDb } from "../db/ensure-db";

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
