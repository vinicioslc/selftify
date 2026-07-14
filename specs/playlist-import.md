# Playlist Import by URL

## Problem

No way to import a YouTube playlist (or single video) by URL. User must search manually and add songs one by one.

## Solution

Allow the user to paste a YouTube URL (playlist or single video) in the search page UI. The backend resolves it via yt-dlp and returns the list of songs. User can download individually, in batch, or save as a persistent playlist.

## Flow

```
1. User selects "Playlist" mode in search page
2. Pastes URL, clicks "Carregar"
3. Backend resolves via yt-dlp --flat-playlist --dump-json
4. Results appear in DataTable with per-row download + selection toggle
5. Actions:
   - Download per song (existing DownloadButton)
   - Select All / Deselect All
   - Download Selected → enqueueMultiple
   - Download All → enqueueMultiple
   - Save as Playlist → persist to DB + toast
6. Saved playlist appears in playlist list (badge "Importada")
7. Playlist detail has "Refresh" button that re-resolves the URL
```

## Backend

### Tables

```sql
CREATE TABLE IF NOT EXISTS imported_playlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT,
  image_url TEXT,
  song_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS imported_playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES imported_playlists(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  uploader TEXT,
  duration INTEGER,
  thumbnail TEXT,
  position INTEGER NOT NULL,
  downloaded INTEGER DEFAULT 0,
  PRIMARY KEY (playlist_id, video_id)
);
```

### Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/selftify/youtube/resolve | `{ url }` → yt-dlp resolve → `{ playlist, songs }` |
| POST | /api/selftify/youtube/playlist/save | `{ url, name, songs }` → persist → `{ playlist }` |
| PUT | /api/selftify/youtube/playlist/:id/refresh | re-resolve saved URL → update DB → `{ playlist, songs }` |
| GET | /api/selftify/playlists | list imported playlists |
| GET | /api/selftify/playlist/:id | detail + songs of imported playlist |

### Service: `youtube-playlist.ts`

Uses yt-dlp with `--flat-playlist --dump-json`. Handles both single video and playlist URLs. Extracts id, title, uploader, duration, thumbnail per entry. Converts to `Song[]` with `originType=YOUTUBE`, `youtubeVideoId` set, `path=null`.

## Frontend

### Types

Extend `Playlist` with optional fields:
- `sourceUrl?: string`
- `imported?: boolean`
- `source?: string`

### Search Page

New `SearchMode = "playlist"`. UI:
- Input for URL (placeholder: "Cole a URL do YouTube (música ou playlist)")
- Button "Carregar"
- Results in DataTable with `searchColumns` + per-row selection toggle
- Header: Select All / Deselect All + Download Selected + Download All + Save as Playlist
- Selection state: `Set<string>` of song IDs

### Playlist List Page

Fetch imported playlists from `/api/selftify/playlists` and merge with controller playlists. Show badge "Importada" on imported ones.

### Playlist Detail Page

If `playlist.imported`:
- Show "Refresh" button (re-resolve URL)
- Add per-row selection toggle + "Download Selected" button
- Keep existing "Play All", "Delete", "Rename"

## Files Changed

| File | Change |
|------|--------|
| `specs/playlist-import.md` | New spec |
| `server/src/services/youtube-playlist.ts` | New yt-dlp resolver |
| `server/src/db/connection.ts` | Add tables |
| `server/src/db/queries.ts` | Add CRUD queries |
| `server/src/app.ts` | Add endpoints |
| `src/types/domain-types.ts` | Extend Playlist type |
| `src/features/search/search-page.tsx` | Add playlist mode |
| `src/features/playlist/playlist-list-page.tsx` | Show imported playlists |
| `src/features/playlist/playlist-detail-page.tsx` | Refresh + download selected |
| `src/services/playlist-import-service.ts` | New frontend API client |
