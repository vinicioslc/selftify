import { query, exec } from "../database";
import type { SqliteDbRankingLogEntry } from "../../sqlite-db/sqlite-db-types";

interface RankingRow {
  id: string;
  query: string;
  winner_id: string;
  winner_title: string;
  winner_uploader: string | null;
  score: number;
  scores: string;
  candidates: number;
  created_at: number;
}

function rowToEntry(row: RankingRow): SqliteDbRankingLogEntry {
  return {
    id: row.id,
    query: row.query,
    winnerId: row.winner_id,
    winnerTitle: row.winner_title,
    winnerUploader: row.winner_uploader || "",
    score: row.score,
    scores: row.scores,
    candidates: row.candidates,
    createdAt: row.created_at,
  };
}

export function recordRanking(entry: Omit<SqliteDbRankingLogEntry, "createdAt" | "id">): void {
  const now = Date.now();
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  exec(
    `INSERT INTO ranking_log (id, query, winner_id, winner_title, winner_uploader, score, scores, candidates, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, entry.query, entry.winnerId, entry.winnerTitle, entry.winnerUploader, entry.score, entry.scores, entry.candidates, now],
  );
}

export function getRecentRankings(limit = 50): SqliteDbRankingLogEntry[] {
  return query<RankingRow>(
    "SELECT * FROM ranking_log ORDER BY created_at DESC LIMIT ?",
    [limit],
  ).map(rowToEntry);
}

export function clearRankingLog(): void {
  exec("DELETE FROM ranking_log");
}
