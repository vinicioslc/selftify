export const SCHEMA_VERSION = 4;

export const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS _meta (
    version INTEGER NOT NULL
  )`,
  `INSERT OR IGNORE INTO _meta (version) VALUES (${SCHEMA_VERSION})`,

  `CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS artists (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    sort_name       TEXT,
    mbz_id          TEXT,
    biography       TEXT,
    genres          TEXT DEFAULT '[]',
    country         TEXT,
    type            TEXT,
    disambiguation  TEXT,
    images          TEXT DEFAULT '[]',
    updated_at      INTEGER NOT NULL,
    enriched_at     INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name COLLATE NOCASE)`,

  `CREATE TABLE IF NOT EXISTS albums (
    id                    TEXT PRIMARY KEY,
    artist_id             TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    artist_name           TEXT NOT NULL,
    album_artist          TEXT,
    release_year          INTEGER,
    mbz_id                TEXT,
    mbz_release_group_id  TEXT,
    genres                TEXT DEFAULT '[]',
    images                TEXT DEFAULT '[]',
    song_count            INTEGER DEFAULT 0,
    duration              INTEGER DEFAULT 0,
    updated_at            INTEGER NOT NULL,
    enriched_at           INTEGER,
    deleted_at            INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_albums_artist_id ON albums(artist_id)`,
  `CREATE INDEX IF NOT EXISTS idx_albums_name ON albums(name COLLATE NOCASE)`,

  `CREATE TABLE IF NOT EXISTS tracks (
    id                TEXT PRIMARY KEY,
    album_id          TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    path              TEXT NOT NULL,
    name              TEXT NOT NULL,
    artist_name       TEXT NOT NULL,
    album_name        TEXT,
    track_number      INTEGER,
    disc_number       INTEGER,
    duration          INTEGER,
    genre             TEXT,
    mbz_recording_id  TEXT,
    mbz_track_id      TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tracks_album_id ON tracks(album_id)`,

  `CREATE TABLE IF NOT EXISTS mappings (
    mbz_recording_id  TEXT PRIMARY KEY,
    song_name         TEXT NOT NULL,
    artist_name       TEXT NOT NULL,
    selected_video_id  TEXT,
    selected_type     TEXT,
    candidates        TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ranking_log (
    id              TEXT PRIMARY KEY,
    query           TEXT NOT NULL,
    winner_id       TEXT NOT NULL,
    winner_title    TEXT NOT NULL,
    winner_uploader TEXT,
    score           REAL NOT NULL,
    scores          TEXT NOT NULL,
    candidates      INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ranking_log_created_at ON ranking_log(created_at)`,

  `CREATE TABLE IF NOT EXISTS search_cache (
    key         TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,
    query       TEXT NOT NULL,
    results     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_search_cache_provider ON search_cache(provider)`,

  `CREATE TABLE IF NOT EXISTS query_cache (
    id          TEXT PRIMARY KEY,
    platform    TEXT NOT NULL,
    query_hash  TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    ttl         INTEGER NOT NULL,
    results     TEXT NOT NULL,
    origin_id   TEXT,
    raw         TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_query_cache_platform ON query_cache(platform)`,

  `CREATE TABLE IF NOT EXISTS cover_cache (
    id          TEXT PRIMARY KEY,
    artist_name TEXT NOT NULL,
    album_name  TEXT NOT NULL,
    hash        TEXT NOT NULL,
    format      TEXT NOT NULL DEFAULT 'image/jpeg',
    source_url  TEXT,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cover_cache_names ON cover_cache(artist_name COLLATE NOCASE, album_name COLLATE NOCASE)`,

  `CREATE TABLE IF NOT EXISTS request_cache (
    cache_key   TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    method      TEXT NOT NULL DEFAULT 'GET',
    status      INTEGER NOT NULL,
    headers     TEXT,
    body        BLOB,
    content_type TEXT,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  )`,
];
