import { query, exec } from "../database";
import type { SqliteDbMbzYtMapping, CandidateData } from "../../sqlite-db/sqlite-db-types";

interface MappingRow {
  mbz_recording_id: string;
  song_name: string;
  artist_name: string;
  selected_video_id: string | null;
  selected_type: string | null;
  candidates: string | null;
  created_at: number;
  updated_at: number;
}

function rowToMapping(row: MappingRow): SqliteDbMbzYtMapping {
  return {
    mbzRecordingId: row.mbz_recording_id,
    songName: row.song_name,
    artistName: row.artist_name,
    selectedVideoId: row.selected_video_id ?? undefined,
    selectedType: (row.selected_type as SqliteDbMbzYtMapping["selectedType"]) ?? undefined,
    candidates: row.candidates ? JSON.parse(row.candidates) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as SqliteDbMbzYtMapping;
}

export function getMapping(mbzRecordingId: string): SqliteDbMbzYtMapping | null {
  const rows = query<MappingRow>("SELECT * FROM mappings WHERE mbz_recording_id = ?", [mbzRecordingId]);
  return rows.length ? rowToMapping(rows[0]) : null;
}

export function upsertMapping(mapping: SqliteDbMbzYtMapping): void {
  exec(
    `INSERT OR REPLACE INTO mappings (mbz_recording_id, song_name, artist_name, selected_video_id, selected_type, candidates, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      mapping.mbzRecordingId, mapping.songName, mapping.artistName,
      mapping.selectedVideoId || null, mapping.selectedType || null,
      JSON.stringify(mapping.candidates || []),
      mapping.createdAt, mapping.updatedAt,
    ],
  );
}

export function deleteMapping(mbzRecordingId: string): void {
  exec("DELETE FROM mappings WHERE mbz_recording_id = ?", [mbzRecordingId]);
}

export function getAllMappings(): SqliteDbMbzYtMapping[] {
  return query<MappingRow>("SELECT * FROM mappings").map(rowToMapping);
}

export function clearAllMappings(): void {
  exec("DELETE FROM mappings");
}
