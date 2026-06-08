# API & Data Spec: Playlist System

> **Status**: implemented
> **Created**: 2026-06-04
> **Updated**: 2026-06-05 — Refactored from Dexie to file-based `.selftifylist` storage
> **Target**: `selftify` — create, manage, and play saved playlists

---

## Storage Layer (filesystem)

### File format

Each playlist is stored as a `.selftifylist` file:

```
<folderPath>/playlists/<name>.selftifylist
```

Where `folderPath` = `useAuthStore.getState().currentOrigin.folderPath`.

**File content**: A valid JSON array of MusicBrainz Recording ID strings:

```json
["mbz-rec-111", "mbz-rec-222", "mbz-rec-333"]
```

### Name sanitization

```typescript
function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}
```

---

## Service Layer — `src/services/playlist-service.ts`

### Types

```typescript
export interface SelftifyPlaylist {
  id: string;           // Full file path (e.g., "/music/playlists/Road Trip.selftifylist")
  name: string;         // Derived from file name (without .selftifylist extension)
  originId: string;     // From currentOrigin.id
  songCount: number;    // Length of MBID array
  createdAt: number;    // file.mtimeMs or Date.now()
  updatedAt: number;    // file.mtimeMs or Date.now()
}
```

### Playlist CRUD

```typescript
export async function createPlaylist(
  name: string,
  originId: string,
  description?: string
): Promise<SelftifyPlaylist>
```
- Sanitizes name → `<folderPath>/playlists/<name>.selftifylist`
- Writes `[]` to the file
- Ensures `playlists/` directory exists (creates if missing)
- Returns playlist metadata

```typescript
export async function deletePlaylist(id: string): Promise<void>
```
- Deletes the file at `id` (file path)

```typescript
export async function renamePlaylist(id: string, name: string): Promise<void>
```
- Computes new path with new name
- If destination exists and differs, deletes it first
- Renames file from old path to new path

```typescript
export async function getAllPlaylists(): Promise<SelftifyPlaylist[]>
```
- Lists all `.selftifylist` files in `<folderPath>/playlists/`
- Returns sorted by `updatedAt` DESC

```typescript
export async function getPlaylistById(id: string): Promise<SelftifyPlaylist | null>
```
- Checks file existence
- Returns null if not found
- Returns metadata (name, songCount, etc.)

### Playlist Songs CRUD

```typescript
export async function addSongToPlaylist(playlistId: string, mbid: string): Promise<void>
```
- Reads file → array of MBIDs
- If `mbid` already in array → no-op (dedup)
- Appends `mbid` → writes file

```typescript
export async function removeSongFromPlaylist(playlistId: string, mbid: string): Promise<void>
```
- Reads file → array of MBIDs
- Filters out `mbid` → writes file
- No-op if `mbid` not found

```typescript
export async function getPlaylistSongIds(playlistId: string): Promise<string[]>
```
- Reads file → returns MBID array

```typescript
export async function reorderPlaylistSongs(playlistId: string, mbids: string[]): Promise<void>
```
- Writes the entire new MBID array to file (replaces order)

```typescript
export async function getPlaylistSongCount(playlistId: string): Promise<number>
```
- Returns length of MBID array

```typescript
export async function isSongInPlaylist(playlistId: string, mbid: string): Promise<boolean>
```
- Returns `mbids.includes(mbid)`

```typescript
export async function getPlaylistsForSong(mbid: string): Promise<SelftifyPlaylist[]>
```
- Scans ALL `.selftifylist` files
- Returns those containing the given MBID
- O(n) in number of playlists

---

## Controller Changes — `src/api/local/local-controller.ts`

### Updated methods

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

### DTO mapper

```typescript
// src/services/dto.ts
export function selftifyPlaylistToPlaylist(sp: SelftifyPlaylist): Playlist {
  return {
    id: sp.id,
    originId: sp.originId,
    originType: OriginType.LOCAL,
    name: sp.name,
    songCount: sp.songCount,
    imageUrl: null,
  };
}
```

---

## App.tsx State Changes

```typescript
const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
```

Navigation handler:

```typescript
function handleNavigatePlaylist(playlist: Playlist) {
  pushNavEntry(currentView, selectedAlbum, selectedArtist);
  setSelectedPlaylist(playlist);
  setSelectedAlbum(null);
  setSelectedArtist(null);
  setCurrentView("playlist-detail");
}
```

---

## Platform Service Extensions

New methods added to `PlatformService` interface:

```typescript
writeFile(path: string, data: Uint8Array): Promise<boolean>;
deleteFile(path: string): Promise<boolean>;
createDirectory(path: string): Promise<boolean>;
renameFile(oldPath: string, newPath: string): Promise<boolean>;
```

---

## Store Changes

No new Zustand store needed. The service reads `folderPath` from `useAuthStore.getState().currentOrigin.folderPath` at call time (not on module load), allowing it to work outside React components.

---

## Song Resolution from Playlist

When playing a playlist:

```
getPlaylistSongIds(playlistId) → string[] (MBIDs)
  └─ for each mbid → getSongByMbid(mbid) → DbSong | null
      └─ dbSongToSong() → Song
          └─ setQueue(songs, { type: "now" })
```

### Song lookup by MBID

Added to `src/services/local-database.ts`:

```typescript
export async function getSongByMbid(mbid: string): Promise<DbSong | null> {
  return (await db.songs.where("mbz_recording_id").equals(mbid).first()) || null;
}
```

---

## Error Handling

| Error | Behavior |
|---|---|
| No folder path configured | `getPlaylistsDir()` throws |
| Create duplicate name | Allowed (last write wins) |
| Delete non-existent file | Silent no-op (file not found) |
| Add song to non-existent playlist | Creates file if missing |
| Add empty MBID | No-op silently |
| Song not found when resolving | Skipped in play queue |
| Song without MBID | Cannot be added (no-op in dialog) |
| File I/O error | `console.warn` + empty/safe return |
