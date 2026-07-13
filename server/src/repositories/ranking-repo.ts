import { getDb } from "../db/connection";

export interface RankingLogEntry {
  id: string;
  query: string;
  winnerId: string;
  winnerTitle: string;
  winnerUploader: string;
  score: number;
  scores: string;
  candidates: number;
  createdAt: number;
}

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

function rowToEntry(row: RankingRow): RankingLogEntry {
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

export function recordRanking(
  entry: Omit<RankingLogEntry, "createdAt" | "id">,
): void {
  const db = getDb();
  const now = Date.now();
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO ranking_log (id, query, winner_id, winner_title, winner_uploader, score, scores, candidates, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.query,
    entry.winnerId,
    entry.winnerTitle,
    entry.winnerUploader,
    entry.score,
    entry.scores,
    entry.candidates,
    now,
  );
}

export function getRecentRankings(limit = 50): RankingLogEntry[] {
  const db = getDb();
  return (
    db
      .prepare("SELECT * FROM ranking_log ORDER BY created_at DESC LIMIT ?")
      .all(limit) as RankingRow[]
  ).map(rowToEntry);
}

export function clearRankingLog(): void {
  getDb().prepare("DELETE FROM ranking_log").run();
}
