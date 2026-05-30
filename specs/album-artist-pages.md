# Spec: Album & Artist Detail Pages with Navigation

> **Status**: implemented  
> **Created**: 2026-05-28  
> **Target**: `yt-music-player` — drill-down navigation for albums and artists

---

## Problem

The application had no way to view album or artist details. Album cards, artist avatars, and artist/album names in search results and library listings were static — clicking them did nothing. The `ServerController` interface had `getAlbumDetail()`/`getAlbumArtistDetail()` methods, but they were never called from any UI code.

Users needed:
1. Click on an album → see album info + full track listing
2. Click on an artist → see artist info + albums grouped + all songs
3. Images cached from local MP3s to appear in all of these views

---

## Solution

Add two new view states (`album-detail`, `artist-detail`) to the existing state-based router. Create dedicated page components and wire every clickable album/artist reference across the app to navigate to them.

---

## Architecture

```
                    App.tsx (state-based router)
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
      AlbumPage                  ArtistPage
      (album detail)             (artist detail)
            │                         │
            │  getAlbumSongs()        │  getArtistSongs()
            ▼                         ▼
      ServerController           ServerController
            │                         │
      ┌─────┴──────┐           ┌──────┴──────┐
      │ Local      │           │ Local       │
      │ getSongsBy │           │ getSongsBy  │
      │ Album()    │           │ Artist()    │
      └────────────┘           └─────────────┘
```

Navigation flow:

```
SearchPage                          LibraryPage
  ┌──────────┬───────────┐           ┌──────────┬───────────┐
  │ Album    │ Artist    │           │ Artist   │ Album     │
  │ Card     │ Avatar    │           │ Name     │ Name      │
  │ (click)  │ (click)   │           │ (click)  │ (click)   │
  └────┬─────┴─────┬─────┘           └────┬─────┴─────┬─────┘
       ▼           ▼                      ▼           ▼
  AlbumPage   ArtistPage              AlbumPage   ArtistPage
       │           │
       │           └── Album name/cover (click) ──► AlbumPage
       ▼
  Song list with Play buttons
```

---

## View States

### New `AppView` entries

```typescript
// src/types/types.ts
export type AppView =
  | "home"
  | "search"
  | "library-albums"
  | "library-artists"
  | "library-songs"
  | "playlists"
  | "settings"
  | "now-playing"
  | "album-detail"    // <-- new
  | "artist-detail";  // <-- new
```

### App.tsx — Navigation state

```typescript
const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
const [selectedArtist, setSelectedArtist] = useState<AlbumArtist | null>(null);
```

Navigation handlers:
- `handleNavigateAlbum(album)` — sets selected album, switches to `album-detail`
- `handleNavigateArtist(artist)` — sets selected artist, switches to `artist-detail`
- `handleBack()` — clears selection, goes back to `search`
- `handleNavigateFromArtist(albumName, artistName)` — constructs Album from name, navigates to AlbumPage

---

## Pages

### AlbumPage (`src/features/album/album-page.tsx`)

| Section | Content |
|---|---|
| **Back button** | `ArrowLeft` icon + "Back" → calls `onBack()` |
| **Hero section** | Large album cover (Avatar, `h-48 w-48 md:h-56 md:w-56`), badge "Album", title (`text-3xl font-bold`), artist + year, song count + avg duration, "Play All" button |
| **Song list** | Numbered rows (track number / index), title, artist, duration, Play button on hover. Header row with `#`, "Title", clock icon. Empty state text when no songs found |

Props:
```typescript
interface AlbumPageProps {
  album: Album;
  onBack: () => void;
}
```

Data fetching:
- On mount calls `controller.getAlbumSongs(album.albumArtistName, album.name)`
- For local origin: uses `getSongsByAlbum()` from SQLite (returns all songs matching artist+album)
- For remote origins: returns `[]` (empty state shown)
- Filters results by `song.albumName === album.name` for safety

### ArtistPage (`src/features/artist/artist-page.tsx`)

| Section | Content |
|---|---|
| **Back button** | `ArrowLeft` icon + "Back" → calls `onBack()` |
| **Hero section** | Large circle avatar (`h-40 w-40 md:h-48 md:w-48`), badge "Artist", title (`text-3xl font-bold`), album + song counts, "Play All" button |
| **Album groups** | Each album shown as a section: small cover + album name (clickable → AlbumPage), Play Album button, then numbered song rows (track#, title, duration, Play) |

Props:
```typescript
interface ArtistPageProps {
  artist: AlbumArtist;
  onBack: () => void;
  onNavigateAlbum: (albumName: string, artistName: string) => void;
}
```

Data fetching:
- On mount calls `controller.getArtistSongs(artist.name)`
- For local origin: uses `getSongsByArtist()` from SQLite
- Groups songs by `albumName` into `GroupedAlbum` objects
- Sorts: named albums first (alphabetical), "Other" (songs without album) last

---

## Clickable Navigation Points

### SearchPage (`src/features/search/search-page.tsx`)

| Element | Action | Navigates to |
|---|---|---|
| Album card (Card wrapper) | `onClick` | `AlbumPage` with the search result's Album |
| Artist avatar + name | `onClick` on wrapper div | `ArtistPage` with the search result's AlbumArtist |
| Artist name in song row | `onClick` on `<p>` | `ArtistPage` (constructs AlbumArtist from song fields) |
| Album badge in song row | `onClick` on `<Badge>` | `AlbumPage` (constructs Album from song fields) |

Props added:
```typescript
interface SearchPageProps {
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
}
```

### LibraryPage (`src/features/library/library-page.tsx`)

| Element | Action | Navigates to |
|---|---|---|
| Artist name in song row | `onClick` on `<span>` | `ArtistPage` |
| Album name in song row | `onClick` on `<span>` | `AlbumPage` |

Props added:
```typescript
interface LibraryPageProps {
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
}
```

Images: `dbSongToSong` now resolves `imageUrl` from the IndexedDB image cache using the same tag resolution as the local controller (`song/<id>` → `album/<artist>/<album>` → `artist/<artist>`).

---

## Controller Changes

### `ServerController` interface (`src/api/controller.ts`)

Two new methods added:

```typescript
interface ServerController {
  // ...existing methods...
  getAlbumSongs(albumArtist: string, album: string): Promise<Song[]>;
  getArtistSongs(artist: string): Promise<Song[]>;
}
```

### Local controller (`src/api/local/local-controller.ts`)

```typescript
getAlbumSongs: async (albumArtist, album) => {
  const rows = await getSongsByAlbum(albumArtist, album);  // SQLite
  const songs = rows.map(toSong);
  return populateSongImages(songs);                         // resolve imageUrl
},

getArtistSongs: async (artist) => {
  const rows = await getSongsByArtist(artist);              // SQLite
  const songs = rows.map(toSong);
  return populateSongImages(songs);
},
```

### Remote controllers (Navidrome, Jellyfin, YouTube)

All return `[]` (empty). The pages gracefully show an empty state.

---

## Database Queries

### New queries in `src/services/local-database.ts`

```sql
-- getSongsByAlbum(artistName, albumName)
SELECT * FROM songs
WHERE artist_name = $1 AND album_name = $2
ORDER BY disc_number, track_number

-- getSongsByArtist(artistName)
SELECT * FROM songs
WHERE artist_name = $1
ORDER BY album_name, disc_number, track_number
```

These were added in the cover-art cache spec but are essential for the album/artist pages.

---

## Files Summary

| File | Action | Purpose |
|---|---|---|
| `src/types/types.ts` | MODIFY | Add `"album-detail"` and `"artist-detail"` to `AppView` |
| `src/api/controller.ts` | MODIFY | Add `getAlbumSongs()` and `getArtistSongs()` to `ServerController` |
| `src/api/local/local-controller.ts` | MODIFY | Implement `getAlbumSongs()` and `getArtistSongs()` using SQLite |
| `src/api/navidrome/navidrome-controller.ts` | MODIFY | Stub `getAlbumSongs()` and `getArtistSongs()` → `[]` |
| `src/api/jellyfin/jellyfin-controller.ts` | MODIFY | Stub `getAlbumSongs()` and `getArtistSongs()` → `[]` |
| `src/api/youtube/youtube-controller.ts` | MODIFY | Stub `getAlbumSongs()` and `getArtistSongs()` → `[]` |
| `src/App.tsx` | MODIFY | Add album/artist state, navigation handlers, view routing |
| `src/features/album/album-page.tsx` | **CREATE** | Album detail page with track listing |
| `src/features/artist/artist-page.tsx` | **CREATE** | Artist detail page with album grouping |
| `src/features/search/search-page.tsx` | MODIFY | Add navigation props, make elements clickable |
| `src/features/library/library-page.tsx` | MODIFY | Add navigation props, make names clickable, resolve images from cache |

---

## Edge Cases & States

| State | Behavior |
|---|---|
| **Album with no songs found** | Album page shows hero section + "No songs found in this album." |
| **Artist with no songs found** | Artist page shows hero section + "No songs found for this artist." |
| **Song without album name** | In ArtistPage, grouped under "Other" section (sorted last) |
| **Song without track number** | Uses array index + 1 as fallback |
| **Remote origin (no getAlbumSongs)** | Album/Artist page shows info but empty song list with message |
| **Back from album/artist** | Clears selectedAlbum/selectedArtist, navigates to "search" |
| **From ArtistPage → AlbumPage** | Constructs Album from artist+album name, `imageUrl: null` (will be resolved in AlbumPage if local) |

---

## Future Enhancements

1. **Remote album songs**: Implement `getAlbumSongs` / `getArtistSongs` for Navidrome (Subsonic `getAlbum` endpoint returns songs) and Jellyfin (Items by ParentId)
2. **Library albums/artists tabs**: Currently `library-albums` and `library-artists` render the same `LibraryPage`. They could render album grid / artist grid views with navigation to the detail pages
3. **Scroll restoration**: Remember scroll position when going back from detail page
4. **Animated transitions**: View transitions between search/list and detail pages
