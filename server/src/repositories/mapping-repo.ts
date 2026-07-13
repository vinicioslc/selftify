import { getDb } from "../db/connection";

export interface MbzYtMapping {
  mbzRecordingId: string;
  songName: string;
  artistName: string;
  selectedVideoId?: string | null;
  selectedType?: string | null;
  candidates: unknown[];
  createdAt: number;
  updatedAt: number;
}

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

function rowToMapping(row: MappingRow): MbzYtMapping {
  return {
    mbzRecordingId: row.mbz_recording_id,
    songName: row.song_name,
    artistName: row.artist_name,
    selectedVideoId: row.selected_video_id ?? undefined,
    selectedType: row.selected_type ?? undefined,
    candidates: row.candidates ? JSON.parse(row.candidates) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getMapping(mbzRecordingId: string): MbzYtMapping | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM mappings WHERE mbz_recording_id = ?").get(mbzRecordingId) as
    | MappingRow
    | undefined;
  return row ? rowToMapping(row) : null;
}

export function upsertMapping(mapping: MbzYtMapping): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO mappings
       (mbz_recording_id, song_name, artist_name, selected_video_id, selected_type, candidates, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    mapping.mbzRecordingId,
    mapping.songName,
    mapping.artistName,
    mapping.selectedVideoId ?? null,
    mapping.selectedType ?? null,
    JSON.stringify(mapping.candidates || []),
    mapping.createdAt,
    mapping.updatedAt,
  );
}

export function deleteMapping(mbzRecordingId: string): void {
  getDb().prepare("DELETE FROM mappings WHERE mbz_recording_id = ?").run(mbzRecordingId);
}

export function getAllMappings(): MbzYtMapping[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM mappings").all() as MappingRow[]).map(rowToMapping);
}

export function clearAllMappings(): void {
  getDb().prepare("DELETE FROM mappings").run();
}
