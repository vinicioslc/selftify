# Spec: Playlist System

> **Status**: implemented
> **Created**: 2026-06-04
> **Updated**: 2026-06-05 — Refactored from Dexie (IndexedDB) to file-based `.selftifylist` storage
> **Target**: `selftify` — create, manage, and play saved playlists

---

## Problem

The `Playlist` domain type exists, and `ServerController` declares `getPlaylistList()` / `getPlaylistDetail()`. Users need to:

1. Create a named playlist
2. Add songs to a playlist
3. View and play from saved playlists
4. Edit or delete playlists

---

## Solution

A complete playlist system backed by **`.selftifylist` files** stored in the origin's `folderPath/playlists/` directory, with a playlist service layer, controller integration, and full UI.

### File Format

Each playlist is a file `<folderPath>/playlists/<name>.selftifylist` containing a valid JSON array of **MusicBrainz Recording IDs** (`mbzRecordingId`):

```json
["mbid-recording-1", "mbid-recording-2", "mbid-recording-3"]
```

- The **file name** (without `.selftifylist`) is the **playlist display name**
- The **array order** defines the song order in the playlist
- Songs without a `mbzRecordingId` (null/empty) cannot be added to playlists

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      UI Layer                                │
│                                                              │
│  PlaylistListPage        PlaylistDetailPage                  │
│  (grid of playlists)     (song list + header)                │
│       │                        │                             │
│       ├── "Add to Playlist" dialog (on song context)        │
│       └── Create/Delete/Rename actions                      │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                   Controller Layer                           │
│                                                              │
│  ServerController                                           │
│    getPlaylistList() → Playlist[]                            │
│    getPlaylistDetail(id) → Playlist | null                   │
│  Direct imports from UI:                                     │
│    createPlaylist(name) → SelftifyPlaylist                   │
│    deletePlaylist(id) → void                                 │
│    addSongToPlaylist(playlistId, mbid) → void                │
│    removeSongFromPlaylist(playlistId, mbid) → void           │
│    renamePlaylist(id, name) → void                           │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                   Service Layer                              │
│                                                              │
│  src/services/playlist-service.ts                            │
│  ── File-based CRUD on .selftifylist files                  │
│  ── Uses PlatformService for file I/O                       │
│  ── Uses useAuthStore.getState() to get folderPath          │
│  ── resolvePlaylistSongs() via getSongByMbid()              │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                   Storage Layer (filesystem)                  │
│                                                              │
│  <folderPath>/playlists/                                     │
│    ├── My Playlist.selftifylist    → ["mbid1", "mbid2"]     │
│    ├── Chill Vibes.selftifylist    → ["mbid3"]              │
│    └── Road Trip.selftifylist      → ["mbid4", "mbid5"]     │
└──────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **MusicBrainz IDs as identifiers**: Playlists store `mbzRecordingId` values, making them portable across instances. Songs are resolved by MBID at playback time via `getSongByMbid()`.

2. **File name = playlist name**: The `.selftifylist` filename (without extension) IS the playlist name. Special characters in names are sanitized with `_`.

3. **Simple array format**: The file contains only a JSON array of MBID strings — no metadata wrapper. Playlist metadata (song count, dates) is derived from the file system.

4. **Platform Service abstraction**: File operations go through `PlatformService` (Electron IPC or web stub), keeping the service testable and platform-independent.

---

## Storage Layer

### File naming

```
<folderPath>/playlists/<sanitized-name>.selftifylist
```

- `folderPath` = `currentOrigin.folderPath` (from auth store)
- Name sanitization: `replace(/[<>:"/\\|?*]/g, "_")`
- Extension: `.selftifylist`

### Data flow

```
Create:  writeMbidArray(path, [])
Read:    readMbidArray(path) → JSON.parse(decoded) → string[]
Update:  read → modify array → write
Delete:  unlink(path)
Rename:  rename(oldPath, newPath)
```

---

## Service Layer

### File: `src/services/playlist-service.ts`

```typescript
// Types
export interface SelftifyPlaylist {
  id: string;           // full file path
  name: string;         // derived from file name
  originId: string;
  songCount: number;
  createdAt: number;    // file mtime or Date.now()
  updatedAt: number;
}

// CRUD
export async function createPlaylist(name, originId, description?): Promise<SelftifyPlaylist>
export async function deletePlaylist(id): Promise<void>
export async function renamePlaylist(id, name): Promise<void>
export async function getAllPlaylists(): Promise<SelftifyPlaylist[]>
export async function getPlaylistById(id): Promise<SelftifyPlaylist | null>

// Songs
export async function addSongToPlaylist(playlistId, mbid): Promise<void>
export async function removeSongFromPlaylist(playlistId, mbid): Promise<void>
export async function getPlaylistSongIds(playlistId): Promise<string[]>
export async function reorderPlaylistSongs(playlistId, mbids): Promise<void>
export async function getPlaylistSongCount(playlistId): Promise<number>
export async function isSongInPlaylist(playlistId, mbid): Promise<boolean>
export async function getPlaylistsForSong(mbid): Promise<SelftifyPlaylist[]>
```

---

## Controller Changes

### `src/api/local/local-controller.ts`

```typescript
getPlaylistList: async () => {
  const playlists = await getAllPlaylists();
  return playlists.map(selftifyPlaylistToPlaylist);
}

getPlaylistDetail: async (id: string) => {
  const playlist = await getPlaylistById(id);
  if (!playlist) return null;
  return selftifyPlaylistToPlaylist(playlist);
}
```

Where `selftifyPlaylistToPlaylist()` maps `SelftifyPlaylist` → `Playlist` domain type.

---

## UI Components

### 1. PlaylistListPage (`src/features/playlist/playlist-list-page.tsx`)

| Section | Content |
|---|---|
| **Header** | "Playlists" title + "New Playlist" button |
| **Grid** | Cards showing playlist name, song count, created date |
| **Empty state** | "No playlists yet. Create your first playlist!" |
| **Actions** | Click card → navigates to playlist detail. Hover shows Play and Delete buttons. |
| **Play** | Resolves MBIDs → Songs via `getSongByMbid()`, then `setQueue()` |

### 2. PlaylistDetailPage (`src/features/playlist/playlist-detail-page.tsx`)

| Section | Content |
|---|---|
| **Back button** | ArrowLeft + "Back to Playlists" |
| **Header** | Playlist name (editable), song count, "Play All" button, "Delete" button |
| **Song list** | DataTable with columns: cover, title+artist, album, duration, remove button |
| **Empty state** | "This playlist is empty. Add songs from the library or search." |
| **Remove** | Removes song by `mbzRecordingId` from the `.selftifylist` file |

### 3. AddToPlaylistDialog (`src/features/playlist/add-to-playlist-dialog.tsx`)

A dialog triggered from song rows, showing a list of existing playlists + "New Playlist" option. Adds songs by `mbzRecordingId` (MBID). Songs without MBID cannot be added.

---

## Song Resolution from Playlist

When playing a playlist, the flow is:

```
PlaylistDetailPage
  └─ handlePlayAll()
      └─ getPlaylistSongIds(playlistId) → string[] (MBIDs)
          └─ for each mbid → getSongByMbid(mbid) → DbSong | null
              └─ dbSongToSong() → Song
                  └─ setQueue(songs, { type: "now" })
```

Songs whose MBID is not found in the local DB (deleted or not indexed) are silently skipped.

---

## Edge Cases & States

| State | Behavior |
|---|---|
| **No playlists exist** | "Create your first playlist" empty state with CTA |
| **Playlist with 0 songs** | Displays empty song list with guidance text |
| **Add song already in playlist** | No-op (silently ignore duplicate MBID) |
| **Delete playlist with songs** | Deletes the file (no cascade needed) |
| **Playlist not found** | Navigate back to playlist list |
| **Song deleted from library** | MBID remains in file, silently skipped on play |
| **Song without MBID** | Cannot be added to playlist (button disabled / no-op) |
| **Rename to existing name** | Overwrites the existing file |
| **Duplicate playlist names** | Allowed (last write wins — file overwrite) |
| **Special chars in name** | Sanitized: `<>:"/\\|?*` → `_` |
