# Song Listing Pages — Catalog

> **Status**: implemented  
> **Last update**: 2026-06-08  
> **Target**: `selftify` — comprehensive inventory of every page that renders a list of songs, independent of data source (local, YouTube, MusicBrainz).

## Purpose

Document every UI surface that displays a list of songs (tracks) so that:
- Adding a new playback path (e.g. stream URL resolution) can confidently update **all** call sites
- Changes to the `DataTable` or song row layout can be assessed for impact
- New features (crossfade, download, drag-and-drop reorder) know which pages they must integrate with

## Shared Component API

`src/features/shared/song-columns.tsx` exports:

| Export | Type | Description |
|--------|------|-------------|
| `songTitleColumn(options)` | `ColumnDef<Song>` | Title column with CoverImage (h-10 w-10, rounded-md) + title (`text-sm font-medium`) + clickable artist + clickable album (prefixed by `" · "`) |
| `sourceBadgeColumn()` | `ColumnDef<Song>` | Source badge (YT red icon / MB purple "MB" text) for search pages |
| `durationColumn()` | `ColumnDef<Song>` | Plain duration (`formatDuration(Math.round())`, null-safe with `"—"` fallback) |
| `songColumns(options)` | `ColumnDef<Song>[]` | Convenience: `[sourceBadge?, titleColumn, durationColumn]` |

### Options

```ts
interface SongColumnsOptions {
  onNavigateArtist?: (song: Song) => void;  // called with the Song — page wraps it to build AlbumArtist
  onNavigateAlbum?: (song: Song) => void;   // called with the Song — page wraps it to build Album
  showSourceBadge?: boolean;                // prepend source badge column
}
```

### Auto-adaptation by song type

The shared column detects song type via `Song` properties and adapts:

| Property | Check | Local | MusicBrainz | YouTube Pure |
|----------|-------|-------|-------------|--------------|
| Source badge | `song.id.startsWith("ytpure-")` | No badge | Purple "MB" text | Red YouTube SVG |
| Cover fallback | `CoverImage` | `fallback={name.charAt(0)}` | same | same |
| Duration null guard | `song.duration ? ... : "\u2014"` | Shows duration or `—` | same | same |
| Artist click | `onNavigateArtist(song)` | Navigate to artist page | same | same |
| Album click | `onNavigateAlbum(song)` | Navigate to album page | same | same |

Playback resolution is **not** in the column — each page provides its own `onRowDoubleClick` or play button that calls the appropriate resolver (`resolveSong` for MBZ, `playYtPure` for YT, direct `setQueue` for local).

### Usage pattern

```tsx
import { songColumns } from "../../shared/song-columns";

const handleNavArtist = useCallback((song: Song) => {
  onNavigateArtist?.({
    id: `artist-${song.artistName.toLowerCase().replace(/\s+/g, "-")}`,
    originId: song.originId,
    originType: song.originType,
    name: song.artistName,
    imageUrl: song.imageUrl || null,
    mbz: song.mbzArtistId,
  });
}, [onNavigateArtist]);

const columns = [
  ...songColumns({
    onNavigateArtist: handleNavArtist,
    onNavigateAlbum: handleNavAlbum,
  }),
  // page-specific action columns (remove, download, play, etc.)
  { id: "remove", label: "", width: "40px", render: ... },
];
```

### R1 — Shared Song Row Component (Enforced)

All `DataTable<Song>` pages MUST import column definitions from `song-columns.tsx`. Pages append page-specific action columns via spread after the shared columns.

### R2 — One source of column definitions (Enforced)

No page defines its own `ColumnDef<Song>[]` from scratch. Each page imports `songColumns`/`songTitleColumn` and extends with page-specific extras.

## Legend

| Column | Meaning |
|--------|---------|
| **Page** | React component / route name |
| **File** | Source path relative to `src/` |
| **Data source** | How the songs are obtained (controller, store, service) |
| **UI pattern** | How the list is rendered |
| **Playback** | How songs are queued for playback |
| **Song type** | What kind of songs appear (local, YT, MB, mixed) |
| **Columns** | Whether the page defines its own columns inline or uses shared definition |

---

## 1. Library (Local Files) — COMPLIANT

| Property | Value |
|----------|-------|
| **Component** | `LocalPage` |
| **File** | `src/features/local/local-page.tsx` |
| **Route** | `/local` |
| **Data source** | `getAllSongs()` from local SQLite → `dbSongToSong()` → `controller.populateSongImages()` |
| **State** | `songs: Song[]` (line 43), `filteredSongs` (computed), `displaySongs` (paginated) |
| **UI pattern** | `<DataTable>` with `...songColumns({onNavigateArtist, onNavigateAlbum})` + add-to-playlist action column + genres tab |
| **Playback** | `handlePlayAll()`, `handlePlayEntry()`, `handlePlayGenre()` — all call `setQueue()` |
| **Song type** | Local only |
| **Columns** | Uses shared `songColumns` via spread; adds `addToPlaylist` action column |
| **Notes** | Genres tab has genre cards with play buttons that also call `setQueue` |

---

## 2. Search (All Sources) — COMPLIANT

| Property | Value |
|----------|-------|
| **Component** | `SearchPage` |
| **File** | `src/features/search/search-page.tsx` |
| **Route** | `/` (home) or `/search` |
| **Data source** | `controller.search()` (local), `searchMusicBrainz()` (MB), `searchYouTubePure()` (YT) |
| **State** | `localResults: Song[]`, `mbResults: SearchResults`, `ytResults: { songs: Song[] }` |
| **UI pattern** | Three `<DataTable>` instances, each with `sourceBadgeColumn()` + `songTitleColumn()` + custom duration (with play button) + download + add-to-playlist |
| **Playback** | `playSong()` → `setQueue([song])`, `playAll()` → `setQueue(resolved)` — resolves stream URLs for YT/MB |
| **Song type** | Mixed: local, MusicBrainz, YouTube Pure |
| **Columns** | Uses shared `sourceBadgeColumn()` + `songTitleColumn()`; defines custom duration, download, add-to-playlist |
| **Notes** | Most complex playback logic: checks origin type, handles offline, resolves streams. Source badge auto-detects YT/MB/local. |

---

## 3. Album Detail — COMPLIANT

| Property | Value |
|----------|-------|
| **Component** | `AlbumPage` |
| **File** | `src/features/album/album-page.tsx` |
| **Route** | `/album/:albumId` |
| **Data source** | `controller.getAlbumSongs()` (local DB) + `musicbrainz-client.getReleaseDetail()` (MBZ tracks), merged by `mbzRecordingId` or (artistName + trackName) |
| **State** | `songs: Song[]` (line 41) |
| **UI pattern** | `<DataTable>` with track number + `...songColumns({...})` + actions (info, play, download) |
| **Playback** | `playSong()` → resolve → `setQueue([resolved])`, `playAll()` → `resolveSongs()` → `setQueue(all)` |
| **Song type** | Mixed: local + MusicBrainz (merged) |
| **Columns** | Uses shared `songColumns` via spread; adds `track` number and `actions` (info+play+download) |
| **Notes** | Merges same-track from local and MBZ by recording ID or name match. Album artist navigation uses resolved artist image. |

---

## 4. Playlist Detail — COMPLIANT

| Property | Value |
|----------|-------|
| **Component** | `PlaylistDetailPage` |
| **File** | `src/features/playlist/playlist-detail-page.tsx` |
| **Route** | `/playlist/:playlistId` |
| **Data source** | `getPlaylistSongIds()` → `getSongByMbid()` → `dbSongToSong()` |
| **State** | `songs: Song[]` (line 33) |
| **UI pattern** | `<DataTable>` with `...songColumns({...})` + remove button |
| **Playback** | `handlePlayAll()` → `setQueue(songs)`, `handlePlaySong()` → `setQueue([song])` |
| **Song type** | Local (playlist songs are local DB references) |
| **Columns** | Uses shared `songColumns` via spread; adds `remove` action column (X button, calls `removeSongFromPlaylist`) |
| **Notes** | Single-click play; remove button calls `removeSongFromPlaylist()` |

---

## 5. Playlist List

| Property | Value |
|----------|-------|
| **Component** | `PlaylistListPage` |
| **File** | `src/features/playlist/playlist-list-page.tsx` |
| **Route** | `/playlists` |
| **Data source** | `controller.getPlaylistList()` (playlist metadata) |
| **State** | Playlist metadata only |
| **UI pattern** | Card grid/list of playlists (not songs directly) |
| **Playback** | `handlePlay()` → fetches all song IDs → loads songs → `setQueue(songs)` |
| **Song type** | Local (indirect — songs loaded on play) |
| **Notes** | Lists playlists, but has play-all that dynamically loads and queues songs |

---

## 6. Home / Dashboard

| Property | Value |
|----------|-------|
| **Component** | `HomePage` |
| **File** | `src/features/home/home-page.tsx` |
| **Route** | `/` |
| **Data source** | `controller.getAlbumList()` (album list, not songs directly) |
| **State** | Albums only |
| **UI pattern** | `<AlbumCarousel>` + `<AlbumGrid>` with album cards (play-on-hover) |
| **Playback** | `handlePlayAlbum()` → `controller.getAlbumSongs()` → resolve → `setQueue(all)` |
| **Song type** | Local (indirect — songs fetched on play) |
| **Notes** | Lists albums, not songs, but plays songs. Quick actions navigate to local page with sort params. |

---

## 7. Now Playing (Queue)

| Property | Value |
|----------|-------|
| **Component** | `NowPlayingPage` |
| **File** | `src/features/now-playing/now-playing-page.tsx` |
| **Route** | `/now-playing` |
| **Data source** | `usePlayerStore()` — `currentTrack: Track`, `queue: Track[]` |
| **State** | Store-driven (no local state) |
| **UI pattern** | Header with current track info + `<ScrollArea>` with `queue.map()` — follows shared visual pattern (CoverImage h-10 w-10 rounded-md, title + artist · album clickable sub-text, duration, remove button) |
| **Playback** | Read-only display of queue; does NOT call `setQueue` |
| **Song type** | Whatever is in the queue (local, YT, MB) |
| **Notes** | Queue manipulation via `removeFromQueue`, `clearQueue`; does not initiate playback |

---

## 8. Full-Screen Player (Queue tab)

| Property | Value |
|----------|-------|
| **Component** | `FullScreenPlayer` |
| **File** | `src/features/player/full-screen-player.tsx` |
| **Route** | Overlay (triggered from player bar) |
| **Data source** | `usePlayerStore()` — `currentTrack: Track`, `queue: Track[]` |
| **State** | Store-driven |
| **UI pattern** | Tabs: "Visualizer" + "Queue". Queue tab has `queue.map()` — follows shared visual pattern (CoverImage h-10 w-10 rounded-md, title + artist · album clickable sub-text, duration) |
| **Playback** | Read-only display of queue; does NOT call `setQueue` |
| **Song type** | Whatever is in the queue |

---

## 9. Song Info Panel — YouTube Candidates / Local Candidates

| Property | Value |
|----------|-------|
| **Component** | `SongInfoContent` |
| **File** | `src/features/song-info/song-info-content.tsx` |
| **Route** | Inside `SongInfoDialog` (search/album pages) or `MusicInfoPopover` (player bar) |
| **Data source** | `getMbzYtMapping()`, `findLocalCandidates()`, `searchAndRankAll()` |
| **State** | `candidates`, `localCandidates` |
| **UI pattern** | Tabbed panel with radio-button lists (YT candidates with scores, local files with bitrate/samplerate) |
| **Playback** | Does NOT call `setQueue` — informational; selects stream source |
| **Song type** | YouTube video candidates + local file candidates for a single MBZ song |

---

## 10. Download Queue Panel

| Property | Value |
|----------|-------|
| **Component** | `DownloadQueuePanel` |
| **File** | `src/features/download/download-queue-panel.tsx` |
| **Route** | Panel in settings or sidebar |
| **Data source** | `useDownloadStore().tasks` |
| **State** | `tasks` grouped by status (in progress, queued, failed, completed) |
| **UI pattern** | `<TaskCard>` groups showing song name + artist + status/progress bar |
| **Playback** | Does NOT call `setQueue` — informational |
| **Song type** | Any (song.mbid used as key) |

---

## 11. YouTube Ranking Debug Panel

| Property | Value |
|----------|-------|
| **Component** | `YoutubeRankingDebug` |
| **File** | `src/features/debug/youtube-ranking-debug.tsx` |
| **Route** | Debug tool (dev only) |
| **Data source** | `useRankingDebugStore().entries` |
| **State** | `entries` |
| **UI pattern** | Ranked list of scored YT video candidates with match indicators |
| **Playback** | Does NOT call `setQueue` — informational/debug |
| **Song type** | YouTube video candidates |

---

## Shared Components

| Component | File | Used By | Description |
|-----------|------|---------|-------------|
| `DataTable<T>` | `src/features/shared/data-table.tsx` | LocalPage, SearchPage, AlbumPage, PlaylistDetailPage | Generic sortable, resizable table with keyboard nav, context menu, expandable rows |
| `SongInfoContent` | `src/features/song-info/song-info-content.tsx` | SongInfoDialog, MusicInfoPopover | Shared tabbed panel with metadata, YT candidates, local candidates, covers |
| `songColumns` / `songTitleColumn` / `sourceBadgeColumn` / `durationColumn` | `src/features/shared/song-columns.tsx` | LocalPage, SearchPage, AlbumPage, PlaylistDetailPage | Shared column definitions. `songColumns(options)` returns `[title, duration]` (with optional source badge). Pages compose via spread + page-specific columns. |

## Compliance Status (R1/R2)

| Page | Uses shared columns? | Action required |
|------|:-------------------:|-----------------|
| `LocalPage` | ✅ `...songColumns({...})` | Done |
| `SearchPage` | ✅ `sourceBadgeColumn()` + `songTitleColumn()` + custom duration + actions | Done |
| `AlbumPage` | ✅ `...songColumns({...})` + track number + actions | Done |
| `PlaylistDetailPage` | ✅ `...songColumns({...})` + remove button | Done |
| `NowPlayingPage` | N/A (queue.map) — ✅ follows same visual pattern | Done |
| `FullScreenPlayer` | N/A (queue.map) — ✅ follows same visual pattern | Done |



---

## Playback Call-Site Index

Every location that calls `setQueue` from `usePlayerStore()`:

| File | Line(s) | Function | Trigger |
|------|---------|----------|---------|
| `src/features/local/local-page.tsx` | ~175 | `handlePlayAll` | Button |
| `src/features/local/local-page.tsx` | ~179 | `handlePlayEntry` | Row click |
| `src/features/local/local-page.tsx` | ~184 | `handlePlayGenre` | Genre card |
| `src/features/local/local-page.tsx` | ~656 | Context menu | Right-click row |
| `src/features/search/search-page.tsx` | ~399 | `playSong` | Row double-click / context menu |
| `src/features/search/search-page.tsx` | ~427 | `playAll` | Button |
| `src/features/album/album-page.tsx` | ~175 | `playSong` | Row click |
| `src/features/album/album-page.tsx` | ~180 | `playAll` | Button |
| `src/features/playlist/playlist-detail-page.tsx` | ~67 | `handlePlayAll` | Button |
| `src/features/playlist/playlist-detail-page.tsx` | ~97 | `handlePlaySong` | Row click |
| `src/features/playlist/playlist-list-page.tsx` | ~89 | `handlePlay` | Playlist card |
| `src/features/home/home-page.tsx` | ~81 | `handlePlayAlbum` | Album card play button |
| `src/features/now-playing/now-playing-page.tsx` | (none) | — | Read-only |
| `src/features/player/full-screen-player.tsx` | (none) | — | Read-only |

**Rule**: When adding/modifying stream URL resolution logic, grep for `setQueue` across all feature directories — every call site must be evaluated.

---

## Data Flow: Song List → Playback

```
┌─────────────┐     resolveStream?     ┌──────────────┐
│  DataTable   │ ─── yes if !song.path ─▶ setQueue()   │
│  (song list) │                        │  (player)    │
└─────────────┘                        └──────────────┘
     │                                        │
     │ Song[] from                            │ Track[] with
     │ controller / store                     │ resolved .path
     ▼                                        ▼
┌─────────────┐                        ┌──────────────┐
│   Controller │                        │  WebAudio    │
│ (getSongs)   │                        │  Provider    │
└─────────────┘                        └──────────────┘
```

- **Local songs** already have `song.path` → no resolve needed → direct `setQueue`
- **Online songs** (YT/MB) have `song.path = null` → `getStreamUrl(song)` → then `setQueue`

**Mixed pages** (e.g. album with local + online): check `if (song.path)` before calling `getStreamUrl`.
