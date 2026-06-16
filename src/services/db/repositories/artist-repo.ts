import { query, exec } from "../database";
import type { SqliteDbArtistMeta, SqliteDbImage } from "../../sqlite-db/sqlite-db-types";

interface ArtistRow {
  id: string;
  name: string;
  sort_name: string | null;
  mbz_id: string | null;
  biography: string | null;
  genres: string;
  country: string | null;
  type: string | null;
  disambiguation: string | null;
  images: string;
  updated_at: number;
  enriched_at: number | null;
}

function rowToArtist(row: ArtistRow): SqliteDbArtistMeta {
  return {
    $schema: "selftify-artist",
    version: 1,
    name: row.name,
    sortName: row.sort_name,
    mbzId: row.mbz_id,
    biography: row.biography,
    genres: JSON.parse(row.genres || "[]"),
    country: row.country,
    type: row.type,
    disambiguation: row.disambiguation,
    images: JSON.parse(row.images || "[]"),
    updatedAt: row.updated_at,
    enrichedAt: row.enriched_at,
  };
}

function artistToRow(artist: SqliteDbArtistMeta): ArtistRow {
  return {
    id: artist.name,
    name: artist.name,
    sort_name: artist.sortName,
    mbz_id: artist.mbzId,
    biography: artist.biography,
    genres: JSON.stringify(artist.genres || []),
    country: artist.country,
    type: artist.type,
    disambiguation: artist.disambiguation,
    images: JSON.stringify(artist.images || []),
    updated_at: artist.updatedAt,
    enriched_at: artist.enrichedAt,
  };
}

export function getAllArtists(): SqliteDbArtistMeta[] {
  return query<ArtistRow>("SELECT * FROM artists ORDER BY name COLLATE NOCASE").map(rowToArtist);
}

export function findArtistByName(name: string): SqliteDbArtistMeta | null {
  const rows = query<ArtistRow>("SELECT * FROM artists WHERE name COLLATE NOCASE = ?", [name]);
  return rows.length ? rowToArtist(rows[0]) : null;
}

export function artistExists(name: string): boolean {
  const rows = query<{ c: number }>("SELECT COUNT(*) as c FROM artists WHERE name COLLATE NOCASE = ?", [name]);
  return rows[0].c > 0;
}

export function upsertArtist(meta: SqliteDbArtistMeta): void {
  const r = artistToRow(meta);
  exec(
    `INSERT OR REPLACE INTO artists (id, name, sort_name, mbz_id, biography, genres, country, type, disambiguation, images, updated_at, enriched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.id, r.name, r.sort_name, r.mbz_id, r.biography, r.genres, r.country, r.type, r.disambiguation, r.images, r.updated_at, r.enriched_at],
  );
}

export function deleteArtist(name: string): void {
  exec("DELETE FROM artists WHERE name COLLATE NOCASE = ?", [name]);
}
