# Spec: Search Refactor — Local-Only Origin + Online Search

> **Status**: implemented
> **Last update**: 2026-05-30
> **Target**: `selftify` — simplify origin model, unify search flow around LOCAL files with optional MusicBrainz + YouTube online search

## Implementation Log (Kaizen)

This document records the incremental changes made during implementation. Each
entry describes what was done, why, and what was learned.

### Entry 1: Search query fix, cover art caching, image fetching system

**Date**: 2026-05-30

**Problem**: Image sources not loading (404 errors), MusicBrainz search returning empty ("q = missing"), cover art images broken.

**Changes**:
1. `src/services/musicbrainz-client.ts` — `searchRecordings()` uses `rawQuery` (`query: "..."`) instead of field-specific `artist:"..."` / `artistname:"..."` / `release:"..."`. The MB API returned 0 results with field-specific queries for free-text input; `rawQuery` matches everything and is correct for free search.
2. `src/services/musicbrainz-client.ts` — cover art URL changed from `release/` to `release-group/` in `getImageUrl()`. MB's Cover Art Archive is indexed by release-group (the album entity), not individual releases. Using `release/` caused many 404s.
3. `src/services/image-fetch.ts` — **new file**. Legacy-style image caching service. Uses Cache Storage API to store fetched cover art blobs. Implements:
   - `getImageBlob(url)` — tries cache → fetch → store → return Blob
   - `getObjectUrl(url)` — wraps `getImageBlob` returning `URL.createObjectURL(blob)`
   - `revokeObjectUrl(url)` — cleanup helper
   - `getImageElement(url)` — returns `<img>` element with onload/onerror
   - Rate limiting: 50ms delay between requests
   - Retries: 3 attempts per URL
   - Graceful fallback: returns empty/null on failure (no UI crash)
4. `src/features/search/search-page.tsx` — integrated `getObjectUrl`/`revokeObjectUrl` for lazy cover art loading in album cards. Loading state: `loadingCovers: Set<string>`, spinner via `Loader2 animate-spin`.

**Validation**:
- MusicBrainz search now returns results for any query
- Cover art loads from `release-group/` endpoint
- 404 images don't break the page (empty fallback)
- Cache Storage prevents repeated network requests

### Entry 2: Loading spinner, infinite loop fix, processQueue race condition

**Date**: 2026-05-30

**Problem**:
- No visual feedback while cover art loads (blank space)
- Infinite re-render loop causing constant API calls
- `processQueue` could execute multiple times simultaneously

**Changes**:
1. `search-page.tsx` — `handleSearchStateChange` wrapped in `useCallback` with `[searchState]` dependency. Previously the function was recreated on every render (no deps array), causing stale closures that triggered re-render → recall → re-render.
2. `search-page.tsx` — `processQueue` uses a `processing` ref guard:
   ```ts
   const processing = useRef(false);
   if (processing.current) return;
   processing.current = true;
   // ... process items
   processing.current = false;
   ```
   Prevents parallel execution when multiple state updates queue simultaneously.

**Validation**:
- Single API call per keystroke
- Spinner visible during image load
- No infinite loops
- processQueue runs exactly once per update

### Entry 3: Online tracks on album detail page

**Date**: 2026-05-30

**Problem**: Clicking a MusicBrainz album showed no tracks; only locally indexed songs appeared. Albums that exist only in MusicBrainz (not downloaded) were empty.

**Changes**:
1. `src/services/musicbrainz-client.ts` — new function `getReleaseDetail(releaseId)`:
   - Calls `/ws/2/release/{id}?inc=recordings+artist-credits+media&fmt=json`
   - Maps mediums and tracks to `Song[]`
   - Returns `{ songs: Song[], release: MusicBrainzRelease }`
   - Fields populated: `name`, `artistName`, `albumName`, `albumArtistName`, `duration`, `trackNumber`, `discNumber`, `mbzRecordingId`, `mbzTrackId`, `imageUrl` (cover art), `songId` (generated as `"mbz-{recordingId}"`)

2. `src/features/album/album-page.tsx`:
   - If `album.source === "musicbrainz"` (or album has `mbzId`), fetches online tracks via `getReleaseDetail()`
   - Merges local + online songs
   - Lazy cover art fetch: if album has `mbzId` (release group), fetches via `fetchCoverArt()` from `image-fetch.ts` → sets `coverUrl` state
   - Uses `DataTable` for song list

**Validation**:
- Albums with `mbzId` display remote tracks
- Cover art loads from Cover Art Archive
- Local songs still shown if album is partially indexed

### Entry 4: Online artist page with all albums and songs

**Date**: 2026-05-30

**Problem**: The artist page only showed locally indexed albums/songs. For MusicBrainz artists (e.g., from online search), no content appeared.

**Changes**:
1. `src/services/musicbrainz-client.ts` — new function `getArtistReleaseGroups(artistId)`:
   - Calls `/ws/2/release-group?artist={arid}&inc=artist-credits+releases+release-group-artists+primary-type&fmt=json`
   - Returns `MusicBrainzReleaseGroup[]` with album-type, cover art, release year
   - Fetches all pages (pagination via `offset`)

2. `src/features/artist/artist-page.tsx`:
   - Detects `artist.source === "musicbrainz"` (or artist has `mbz` field) for online view
   - Fetches artist's release groups → all albums from MB
   - Fetches recordings per album via `searchRecordings` with `arid:` query
   - Merges local songs with remote (local overrides same-recording remote)
   - Songs not in local Dexie get `(remote)` badge
   - **Duplicate key fix**: album IDs get unique suffix per release group (`album.id + "--" + rg.id`) since different release groups can produce albums with same name
   - Uses `DataTable` for song list

**Validation**:
- All artist albums appear (not just locally indexed)
- Songs show real duration
- Duplicate keys eliminated
- Remote badge visible

### Entry 5: Cover art resolution for search song results

**Date**: 2026-05-30

**Problem**: Song results in search page had no cover art thumbnails.

**Changes**:
1. `src/features/search/search-page.tsx`:
   - Added `loadingSongCovers: Set<string>` state
   - For each song (local + online), resolves cover art:
     - Local songs: use `song.imageUrl` directly
     - Online songs: construct cover art URL from `song.mbzRecordingId` via MB Cover Art Archive
     - Lazy fetch via `image-fetch.ts` with spinner state
   - `getSongImageUrl()` helper: returns URL string or null per song

**Validation**:
- Song rows show cover art thumbnails
- Loading spinner during fetch
- Graceful fallback to no image

### Entry 6: DataTable for song results

**Date**: 2026-05-30

**Problem**: Custom song list rendering was verbose, inconsistent with album/artist tables, and didn't use shadcn DataTable pattern.

**Changes**:
1. `src/features/search/search-page.tsx`:
   - Replaced `{songs.map(song => <div>...)}` with `<DataTable>` component
   - Columns:
     - `cover`: 40×40 image with `object-cover rounded`
     - `titleArtist`: `song.name` + `song.artistName` (secondary text)
     - `album`: `song.albumName`
     - `duration`: `formatDuration(song.duration)`
   - Headers: `#`, `Title & Artist`, `Album`, `Duration`
   - Animation: table row stagger via `animate-in slide-in-from-bottom` (50ms delay per index)
   - Song click triggers playback via `player.store.playQueue()`
   - Uses same column definition pattern as album/artist DataTables

**Validation**:
- Consistent DataTable usage across all search tabs
- Proper duration display
- Cover art thumbnails in cover column
- Row click plays song

### Entry 7: Inc=releases+artist-credits for recording search, duration fix, artist page improvements

**Date**: 2026-05-30

**Problem**:
- Recording search returned no album or release info (missing `inc` parameter)
- Duration values were wrong (MB returns ms, `formatDuration` expects seconds)
- Artist page had duplicate keys for albums with same name

**Changes**:
1. `src/services/musicbrainz-client.ts` — `searchRecordings()` always uses `inc=releases+artist-credits`:
   - Returns release name, artist credits, track number per recording
   - Populates `albumName`, `albumArtistName`, `trackNumber` on `Song` results
   - Previous code only included `inc` when optional `mbzRecordingId` was present

2. `src/features/search/search-page.tsx`:
   - `duration` divided by 1000 before passing to `formatDuration()` (MB returns ms, `formatDuration` divides by 60 for minutes)

3. `src/features/library/artist-detail-page.tsx`:
   - Album IDs: `album.id + "--" + rg.id` to deduplicate same-name albums across release groups
   - Proper duration display across all songs

**Validation**:
- Song results show album name, artist, track number
- Duration displays correctly (seconds not ms)
- Artist page has no duplicate key warnings
- DataTable shows correct `mm:ss` format

### Entry 8: Fix download-on-play — audio provider bypasses controller for path-based songs

**Date**: 2026-05-30

**Problem**: Clicking play on an online search result triggers `downloadAndGetPath()` which
downloads the YouTube audio via yt-dlp and returns a local file path. The song's
`path` field is set, and `setQueue()` is called. However, both audio providers
(`browser-audio-provider.tsx`, `ipc-audio-provider.tsx`) call
`controller.getStreamUrl(trackId)` which does `getSongById(trackId)` → Dexie.
Since the freshly downloaded file is NOT indexed in Dexie yet, `getSongById`
returns null → `getStreamUrl` returns null → no audio plays.

**Root cause**: The controller only knows about songs in the local Dexie database.
A song that was just downloaded from YouTube exists on disk but not in Dexie.
The `path` field on the `QueueSong` was being ignored.

**Changes**:
1. `src/features/player/browser-audio-provider.tsx` — In the `loadTrack` effect,
   before calling `controller.getStreamUrl()`, check if `currentTrack.path` exists.
   If so, read the file directly via `platform.readFile(path)` and create a blob URL
   via `URL.createObjectURL(new Blob([data.buffer]))`. This mirrors the same logic
   the controller itself uses internally in `getStreamUrl()`.
2. `src/features/player/ipc-audio-provider.tsx` — Same fix applied. If `track.path`
   is set, read file directly; otherwise fall back to controller.

**Data flow after fix**:
```
playSong() online result
  → downloadAndGetPath() → filePath
  → setQueue([{ ...song, path: filePath }])
  → audio provider detects currentTrack change
  → checks currentTrack.path  ◄── NEW
    → YES: platform.readFile(path) → Blob → ObjectURL → audio.src
    → NO:  controller.getStreamUrl(trackId) → Dexie → Blob → audio.src
```

**Validation**:
- Online search result play button triggers yt-dlp download
- After download completes, audio plays immediately
- Locally indexed songs still work (fall back to controller when no path)
- Web mode: Electron API unavailable → `downloadAndGetPath` returns null →
  `setQueue([song])` without path → controller handles normally

---


## Problem

The current origin model supports multiple server types (JELLYFIN, NAVIDROME, SUBISONIC, YOUTUBE_MUSIC, LOCAL, MUSICBRAINZ) with complex cross-origin linking (`linkedOriginId`). Search has three modes (`youtube`, `musicbrainz`, `mixed`) driven by `musicBrainzSearchMode`. This complexity is unused — the app only ever needs LOCAL files, optionally enriched with MusicBrainz metadata and YouTube download-on-play.

Major pain points:
1. Users must configure URL even for services whose endpoints are well-known (MusicBrainz, YouTube Music)
2. `useMusicBrainz` is a confusing name — users want "enable online search"
3. YouTube Music requires a cookies file export; a headers textarea is simpler
4. Search mode selection (`youtube`/`musicbrainz`/`mixed`) is unnecessary — only mixed (MB text search + YT play) makes sense
5. Cross-origin linking (`linkedOriginId`) adds invisible complexity — the LOCAL origin IS the origin, online is a feature toggle
6. No download-on-play: clicking play on a MusicBrainz result has no way to fetch audio

---

## Solution

### High-Level Concept

```
┌──────────────────────────────────────────────────────────────────┐
│                        Origin (always LOCAL)                      │
│                                                                   │
│  folderPath: "/home/user/Music"                                   │
│  downloadFolder: "/home/user/Music" (default = folderPath)        │
│                                                                   │
│  enableOnlineSearch: true ───────────────────────────────────┐    │
│  ┌─────────────────────────────────────────────────────────┐ │    │
│  │  musicBrainzToken: "abc123"                             │ │    │
│  │  youtubeMusicHeaders: "cookie: aaa\nuser-agent: bbb"    │ │    │
│  └─────────────────────────────────────────────────────────┘ │    │
│    │                                                          │    │
│    │  ┌─ Search: MusicBrainz API (cached, 5min TTL) ──────┐ │    │
│    │  │  results: Song{name, artist, album, duration, mbid}│ │    │
│    │  └────────────────────────────────────────────────────┘ │    │
│    │                                                          │    │
│    │  ┌─ Play: YouTube yt-dlp search + ranking + download ─┐ │    │
│    │  │  1. query = "title artist"                          │ │    │
│    │  2. ytsearch5 via yt-dlp                               │ │    │
│    │  3. ranking engine                                     │ │    │
│    │  4. download + ffmpeg tag → downloadFolder             │ │    │
│    │  5. index in Dexie                                     │ │    │
│    │  6. play from file                                     │ │    │
│    │  └────────────────────────────────────────────────────┘ │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                   │
│  enableOnlineSearch: false                                         │
│  └── Search: local Dexie (IndexedDB)                              │
│  └── Play: local file stream                                      │
└──────────────────────────────────────────────────────────────────┘
```

### Key Changes

1. **Origin is always LOCAL** — other types (JELLYFIN, NAVIDROME, SUBISONIC, YOUTUBE_MUSIC, MUSICBRAINZ) removed from enum and controller factory
2. **No URL input** — MusicBrainz and YouTube endpoints are hardcoded
3. **`useMusicBrainz` → `enableOnlineSearch`** — clearer name
4. **Cookies file → headers textarea** — user pastes HTTP headers (key: value per line)
5. **Single search mode: mixed** — `musicBrainzSearchMode` removed; MusicBrainz for text search, YouTube for play
6. **Download-on-play** — clicking play on an online result triggers yt-dlp search → ranking → download → play

---

## Architecture

### Data Flow

```
                    ┌──────────────────┐
                    │    Sidebar       │
                    │  Search submenu  │
                    │  ├── Local Files  │
                    │  └── Online       │ (only if enableOnlineSearch)
                    └────────┬─────────┘
                             │ onClick
                             ▼
                    ┌──────────────────┐
                    │   SearchPage     │
                    │ searchMode prop  │
                    │ "local"|"online" │
                    └────────┬─────────┘
                             │ handleSearch(query)
                             ▼
              ┌──────────────┴──────────────┐
              │                              │
         "local"                        "online"
              │                              │
              ▼                              ▼
     local-controller.ts          musicbrainz-client.ts
     → Dexie / IndexedDB          → musicbrainz.org/ws/2
     → searchSongs(query)         → searchRecordings/Releases/Artists
     → Song[]                     → Song[] + Album[] + Artist[]
              │                              │
              │                              │
         "Play" ▶                      "Play" ▶
              │                              │
              ▼                              ▼
     getStreamUrl()                youtube-download-service.ts
     → readFile(path)             → yt-dlp search (ytsearch5:query)
     → Blob → ObjectURL           → ranking (title+artist+album+duration)
                                   → yt-dlp download to downloadFolder
                                   → ffmpeg tag (metadata, cover)
                                   → index in Dexie
                                   → getStreamUrl() → play
```

### Controller System

```
┌─────────────────────────────────────────────┐
│               controller.ts                  │
│                                              │
│  getController()                             │
│    → sempre retorna local-controller         │
│                                              │
│  ApiContext {                                │
│    originId,                                 │
│    originType: OriginType.LOCAL,             │
│    credential,                               │
│    enableOnlineSearch,                       │
│    musicBrainzToken,                         │
│    youtubeMusicHeaders,                      │
│    downloadFolder,                           │
│  }                                           │
│                                              │
│  Removido:                                   │
│  ✗ getSearchController()                     │
│  ✗ createLinkedSearchController()            │
│  ✗ getLinkedContext()                        │
│  ✗ OriginType cases (jellyfin, navidrome,    │
│    subsonic, youtube_music, musicbrainz)     │
└─────────────────────────────────────────────┘
```

---

## Domain Types

### `Origin` — New shape

```typescript
// src/types/domain-types.ts

export enum OriginType {
  LOCAL = "local",
}

export type Origin = {
  id: string;
  name: string;
  type: OriginType;

  // Local files
  folderPath?: string;             // path to music folder (renamed from url)
  downloadFolder?: string;         // where downloads go (default = folderPath)

  // Online search toggle
  enableOnlineSearch?: boolean;    // renamed from useMusicBrainz

  // MusicBrainz
  musicBrainzToken?: string;       // API token (increases rate limit)

  // YouTube Music
  youtubeMusicHeaders?: string;    // NEW: multiline HTTP headers (cookie, user-agent, etc.)
};
```

### `OriginType` enum — Simplified

```typescript
export enum OriginType {
  LOCAL = "local",
}
```

### `ApiContext` — New shape

```typescript
// src/api/controller.ts

export type ApiContext = {
  originId: string;
  originType: OriginType;
  folderPath?: string;             // renamed from baseUrl
  credential?: string;
  enableOnlineSearch?: boolean;    // renamed from useMusicBrainz
  musicBrainzToken?: string;
  youtubeMusicHeaders?: string;
  downloadFolder?: string;
};
```

Removed fields: `baseUrl`, `musicBrainzSearchMode`, `linkedOriginId`

---

## UI Components

### Sidebar (`sidebar.tsx`)

```
Search (expansível)
├── Local Files          (sempre visível se origin LOCAL existe)
└── Online Search        (visível APENAS se enableOnlineSearch = true)
```

Behavior:
- `handleSearchLocal()` → navega para `SearchPage` com `searchMode="local"`
- `handleSearchOnline()` → navega para `SearchPage` com `searchMode="online"`
- Quando `enableOnlineSearch` é falso, só "Local Files" aparece
- "MusicBrainz" button removido
- Origin sub-items por tipo removido (só LOCAL existe)

### Auth Page (`auth-page.tsx`) — New form

```
┌───────────────────────────────────────────────┐
│                Add Source                      │
│                                               │
│  Music Folder                                 │
│  ┌─────────────────────────────────┐ [📁]   │
│  │ /home/user/Music                │        │
│  └─────────────────────────────────┘        │
│                                               │
│  Download Folder (default = Music Folder)     │
│  ┌─────────────────────────────────┐ [📁]   │
│  │ /home/user/Music                │        │
│  └─────────────────────────────────┘        │
│                                               │
│  Enable Online Search          [switch]       │
│                                               │
│  ┌─ Online Search Config ──────────────────┐ │
│  │  MusicBrainz Token                      │ │
│  │  ┌─────────────────────────────────┐    │ │
│  │  │ abc-123-def-456                │    │ │
│  │  └─────────────────────────────────┘    │ │
│  │  (optional — increases rate limit       │ │
│  │   from 1 req/s to ~50 req/s)            │ │
│  │                                         │ │
│  │  YouTube Headers (paste from browser)   │ │
│  │  ┌─────────────────────────────────┐    │ │
│  │  │ cookie: XYZ...                 │    │ │
│  │  │ user-agent: Mozilla/5.0...     │    │ │
│  │  │ authorization: SAPISID...      │    │ │
│  │  └─────────────────────────────────┘    │ │
│  │  (one header per line, key: value)      │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  [Scan Local Files]                           │
└───────────────────────────────────────────────┘
```

Rules:
- No "YouTube + MusicBrainz" tab — only one source type
- No URL input — endpoints are hardcoded
- `youtubeMusicHeaders` is a `<textarea>` where user pastes browser headers
- If `enableOnlineSearch` is off, hide MusicBrainz Token and YouTube Headers
- Download folder defaults to music folder; user can override
- Edit dialog (`origin-edit-dialog.tsx`) follows same layout

### Settings Page (`settings-page.tsx`) — Servers tab

- Origin list shows each saved origin name + type badge ("LOCAL")
- Edit button opens same dialog as auth page
- Select/Delete buttons unchanged

---

## Search Flow

### Local Search

```
SearchPage (searchMode="local")
  │
  ▼
handleSearch(query)
  │
  ▼
local-controller.search(query, 20)
  │
  ▼
local-database.searchSongs(query, limit)
  → Dexie: songs.where("name" | "artist_name" | "album_name")
            .startsWithIgnoreCase(query)
  → Song[]
  │
  ▼
Render: Songs list (albums/artists empty for local search)
  │
  ▼
Play ▶ getStreamUrl(songId)
  → readFile(path) → Blob → URL.createObjectURL → <audio>
```

### Online Search (Mixed)

```
SearchPage (searchMode="online")
  │
  ▼
handleSearch(query)
  │
  ▼
searchMusicBrainz(query, 20)
  → parallel:
    - searchRecordings(q, q, {limit: 20})     → Song[]
    - searchReleases(q, q, {limit: 5})        → Album[]
    - searchArtists(q, {limit: 5})            → Artist[]
  → cache: 5min TTL (LRU + Dexie)
  │
  ▼
Render: Songs + Albums + Artists
  │
  ▼
Play ▶ youtube-download-service.ts
  → buildSearchQuery(song) = `${artist} ${title}`
  → yt-dlp search: ytsearch5:<query>
  → scoreYouTubeResults(videos, {
      title: song.name,
      artist: song.artistName,
      album: song.albumName,
      duration: song.duration,
    })
  → pick top result
  → yt-dlp download --extract-audio --audio-format m4a
    --output "{downloadFolder}/{artist}/{album}/{track} - {title}.m4a"
  → ffmpeg tag: title, artist, album, year, track, cover, MBIDs
  → index in local Dexie database
  → getStreamUrl() → play
```

---

## Ranking Engine

### File: `src/services/youtube-ranking.ts`

Implements the same scoring system from `legacy/feishin/src/renderer/api/youtubemusic/youtubemusic-ranking.ts`.

### Scoring Weights

| Criterion | Points | Condition |
|-----------|--------|-----------|
| `titleMatch` | **+1.0** | Video title (normalized) contains expected title |
| `albumMatch` | **+1.0** | Video title contains expected album name |
| `artistMatch` | **+0.5** | Video title contains expected artist name |
| `exactDuration` | **+0.5** | Video duration (seconds) exactly equals expected |
| `closestDuration` | **+0.2** | Closest duration to expected among all candidates (awarded to exactly one) |

### Sorting (descending)

```
score DESC → durationDiff ASC → originalIndex ASC
```

### Full Algorithm

```typescript
type ScoredVideo = {
  video: { id: string; title: string; duration?: { seconds: number } };
  score: number;
  breakdown: {
    titleMatch: boolean;
    albumMatch: boolean;
    artistMatch: boolean;
    exactDuration: boolean;
    closestDuration: boolean;
  };
  diff: number;       // |actualDuration - expectedDuration|, Infinity if unknown
  originalIndex: number;
};

function scoreYouTubeResults(
  videos: RawSearchVideo[],
  expected: { title: string; artist?: string; album?: string; duration?: number },
): ScoredVideo[]

// 1. Normalize all text (lowercase, trim, remove extra whitespace)
// 2. For each video:
//    - titleMatch: +1.0 if normalized title includes expected title
//    - albumMatch: +1.0 if normalized title includes expected album
//    - artistMatch: +0.5 if normalized title includes expected artist
//    - exactDuration: +0.5 if duration exactly equals expected
//    - diff: Math.abs(actualSeconds - expectedSeconds)
// 3. Second pass: find min diff among all videos
//    - closestDuration: +0.2 for the video(s) with min diff (breaks ties)
// 4. Sort: score DESC, diff ASC, originalIndex ASC
// 5. Return scored + sorted array
```

---

## Download System

### Architecture

```
Renderer                             Main Process (Electron)
────────                             ────────────────────────
                                     ┌──────────────────────┐
youtube-download-                    │  yt-dlp + ffmpeg     │
service.ts                           │                      │
  │                                  │  IPC handlers:       │
  ├──► yt:search(query) ──────────►  │  yt:search           │
  │    ← YtDlpSearchItem[]           │  yt:download          │
  │                                  │                      │
  ├──► ranking                       │  searchYouTube:      │
  │    ← bestVideo                   │  ytsearch5:<query>   │
  │                                  │  --skip-download     │
  ├──► yt:download(request) ──────►  │  --print id,title... │
  │    ← filePath                    │                      │
  │                                  │  downloadAudio:      │
  └──► index in Dexie                │  yt-dlp --extract-   │
      → play                         │  audio --audio-format│
                                     │  m4a --output ...    │
                                     │  ffmpeg -i ... -metadata ... │
                                     └──────────────────────┘
```

### IPC Contract

```typescript
// Preload (electron/preload.ts)
window.electronApi.yt = {
  search: (query: string): Promise<YtDlpSearchItem[]>,
  download: (request: YoutubeDownloadRequest): Promise<string>, // returns file path
};

// Types (src/services/youtube-download-service.ts)
type YtDlpSearchItem = {
  id: string;
  title: string;
  duration: number | null;
  uploader: string;
  uploaderUrl?: string;
};

type YoutubeDownloadRequest = {
  searchQuery: string;
  videoId: string;
  downloadFolder: string;
  metadata: {
    title: string;
    artist: string;
    album?: string;
    albumArtist?: string;
    trackNumber?: number;
    discNumber?: number;
    releaseYear?: number;
    coverArtUrl?: string | null;
    mbzRecordingId?: string;
    mbzTrackId?: string;
    genres?: string[];
  };
};
```

### Main Process Handlers (electron/main.ts)

```typescript
ipcMain.handle('yt:search', async (_event, query: string) => {
  // exec yt-dlp with --skip-download --print JSON
  // parse JSON lines → YtDlpSearchItem[]
  // return array
});

ipcMain.handle('yt:download', async (_event, request: YoutubeDownloadRequest) => {
  // 1. Build yt-dlp command:
  //    yt-dlp https://music.youtube.com/watch?v={videoId}
  //      --extract-audio --audio-format m4a
  //      --output "{downloadFolder}/{artist}/{album}/{title}.m4a"
  // 2. exec yt-dlp
  // 3. ffmpeg tag downloaded file with metadata
  // 4. Return file path
});
```

### Download Folder Structure

```
{downloadFolder}/
  └── {artist}/
       └── {album}/
            └── {trackNumber} - {title}.m4a
```

If no album: `{artist}/Singles/{title}.m4a`

### Tags Applied (ffmpeg)

| Tag | Source |
|-----|--------|
| `title` | song.name |
| `artist` | song.artistName |
| `album` | song.albumName |
| `date` | song.releaseYear |
| `track` | song.trackNumber |
| `disc` | song.discNumber |
| `genre` | song.genres |
| `cover` | song.imageUrl (download + embed) |
| `----:com.apple.iTunes:MusicBrainz Recording Id` | song.mbzRecordingId |
| `----:com.apple.iTunes:MusicBrainz Track Id` | song.mbzTrackId |

### Download States

| State | Behavior |
|-------|----------|
| **File already exists** (by path) | Re-tag with ffmpeg (update metadata), skip re-download |
| **yt-dlp fails** | Return error → show toast "Download failed" |
| **Disk full** | yt-dlp error → user notification |
| **No internet** | yt-dlp timeout → "No internet connection" |

---

## Files Summary

### New Files (this conversation)

| File | Purpose |
|------|---------|
| `src/services/image-fetch.ts` | Legacy-style image caching service (Cache Storage API, blob URLs, rate limiting, retries) |
| `src/services/youtube-ranking.ts` | *(planned)* YouTube search result ranking (scoring) |
| `src/services/youtube-download-service.ts` | *(planned)* Orchestrates yt-dlp search + ranking + download |

### Modified Files (this conversation)

| File | Change |
|------|--------|
| `src/services/musicbrainz-client.ts` | `searchRecordings()` uses `rawQuery` + `inc=releases+artist-credits` always; cover art URL: `release-group/` not `release/`; new `getReleaseDetail(releaseId)`; new `getArtistReleaseGroups(artistId)` |
| `src/services/image-fetch.ts` | **(new)** Cache Storage + blob URL + rate-limited fetch with retries |
| `src/features/search/search-page.tsx` | Image fetching with spinner; `useCallback` for search handler (fix infinite loop); `processing` ref guard (fix race condition); online song cover art resolution; **DataTable** replacing custom song list; duration ÷ 1000 for `formatDuration` |
| `src/features/album/album-page.tsx` | Fetch online tracks via `getReleaseDetail()`; lazy cover art from MB Cover Art Archive via `image-fetch.ts`; DataTable for song list |
| `src/features/artist/artist-page.tsx` | Online artist page via `getArtistReleaseGroups()` + recording search; local/remote merge with `(remote)` badge; unique album keys (`id + "--" + rg.id`); DataTable for song list |
| `src/features/player/browser-audio-provider.tsx` | Check `currentTrack.path` before calling controller; read file directly via platform service for downloaded YouTube audio |
| `src/features/player/ipc-audio-provider.tsx` | Same path-first logic for Electron IPC mpv provider |

### Planned (not yet implemented)

| File | Status |
|------|--------|
| `src/types/domain-types.ts` | New `Origin` shape; remove unused `OriginType` values; remove `musicBrainzSearchMode`, `linkedOriginId` |
| `src/types/types.ts` | Remove `ServerConfig` type if unused |
| `src/stores/auth.store.ts` | Adapt to new `Origin` type |
| `src/api/controller.ts` | Simplify to only local-controller |
| `src/api/local/local-controller.ts` | Adapt to new `ApiContext` |
| `src/features/sidebar/sidebar.tsx` | Remove origin sub-items |
| `src/features/auth/auth-page.tsx` | Single origin form |
| `src/features/settings/settings-page.tsx` | Simplify tabs |
| `src/features/settings/origin-edit-dialog.tsx` | New form |
| `electron/main.ts` | Add yt-dlp IPC handlers |
| `electron/preload.ts` | Expose yt-dlp APIs |

### Removed (planned)

| File | Reason |
|------|--------|
| `src/api/youtube/` entire directory | Replaced by yt-dlp in main process |
| `src/api/musicbrainz/` entire directory | MB client used inline via `src/services/musicbrainz-client.ts` |
| `src/api/jellyfin/` entire directory | Not supported |
| `src/api/navidrome/` entire directory | Not supported |

### Unchanged (reused as-is)

| File | Reason |
|------|--------|
| `src/services/musicbrainz-cache.ts` | Already has 5min TTL; used as-is |
| `src/services/musicbrainz-types.ts` | Types still valid |
| `src/services/local-database.ts` | Dexie storage for songs, albums, artists |
| `src/services/local-database-types.ts` | Types still valid |

---

## Edge Cases & States

| State | Behavior |
|-------|----------|
| **No origin configured** | AuthPage shown (unchanged) |
| **Origin without online search** | Sidebar shows only "Local Files"; SearchPage searches Dexie only |
| **Online search, MusicBrainz API down** | `searchMusicBrainz()` catch → empty results, no crash |
| **Cover art image 404 (Cover Art Archive miss)** | `image-fetch.ts` returns empty (null); UI shows no image, no broken icon |
| **Cover art image loading** | `loadingCovers` / `loadingSongCovers` tracked per item; `Loader2` spinner visible during fetch |
| **Image rate limited (429)** | `image-fetch.ts` retries up to 3 times with delay; blob URL revoked on error |
| **Album has `mbzId` but no local tracks** | `album-page.tsx` fetches via `getReleaseDetail` → songs appear as remote |
| **Album has neither local tracks nor MBZ ID** | Shows "No tracks found" empty state |
| **Artist has no local content but has MBZ ID** | `artist-page.tsx` fetches release groups + recordings → full artist page |
| **Artist page: same album name in multiple release groups** | Album keys use `id + "--" + rg.id` suffix to avoid React duplicate key error |
| **Song not in local Dexie (remote-only)** | Artist name shown with `(remote)` suffix in DataTable |
| **Song duration from MusicBrainz** | MB returns ms; divided by 1000 before `formatDuration()` (which expects seconds) |
| **Recording search: missing `inc` parameter** | Fixed: always includes `inc=releases+artist-credits` so album/artist names populate |
| **Infinite re-render loop** | Fixed: `handleSearchStateChange` wrapped in `useCallback([searchState])` |
| **processQueue race condition** | Fixed: `processing` ref guard prevents parallel queue execution |
| **DataTable: empty song list** | Table renders with headers only + "No results" message |
| **DataTable: song click** | Triggers `playerStore.playQueue()` with clicked song index |
| **Album detail page: cover art not available locally** | Lazy-fetches from `https://coverartarchive.org/release-group/{id}/front` |
| **Online search, MusicBrainz API down** | `searchMusicBrainz()` catch → empty results, no crash |
| **Online search, no YouTube headers** | yt-dlp in main process may still work without auth for some content; if 403, show "YouTube requires authentication" |
| **Online search, play clicked before download finishes** | Show spinner/loading state on play button; prevent double-download |
| **Download succeeds but ffmpeg tagging fails** | File plays without metadata; log warning |
| **File already exists in download folder** | Skip download, re-tag with updated metadata, play existing file |
| **Download folder is same as music folder** | File appears in local library immediately after scan; no duplicate |
| **Download folder differs from music folder** | File is downloaded there; user must add as separate source or trigger rescan |
| **User pastes invalid headers format** | No strict validation; warn if missing `cookie:` or `user-agent:` |
| **yt-dlp not installed** | `execFile` throws ENOENT → show "yt-dlp not found. Install: https://github.com/yt-dlp/yt-dlp" |
| **ffmpeg not installed** | Skip tagging; file plays without metadata; log warning |

---

## Dependencies

### New dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `yt-dlp` | (system binary) | YouTube search + audio download |
| `ffmpeg` | (system binary) | Audio format conversion + metadata tagging |

No new npm packages. Both tools are external binaries invoked via `execFile` in Electron main process.

### Existing dependencies reused

| Technology | Used for |
|------------|----------|
| `musicbrainz-client.ts` | MusicBrainz search API |
| `local-database.ts` (Dexie) | IndexedDB storage for local songs + downloaded songs |
| `image-cache.ts` | Cover art caching |
| Electron `ipcMain`/`ipcRenderer` | Main-renderer communication for yt-dlp |

---

## Migration / Backward Compatibility

Existing saved origins with `musicBrainzSearchMode`, `linkedOriginId`, `useMusicBrainz` will need migration:

```typescript
// Migration logic in auth.store persistence
function migrateOrigin(old: OldOrigin): NewOrigin {
  return {
    id: old.id,
    name: old.name,
    type: OriginType.LOCAL,
    folderPath: old.type === OriginType.LOCAL ? old.url : undefined,
    downloadFolder: undefined,  // defaults to folderPath
    enableOnlineSearch: old.useMusicBrainz ?? false,
    musicBrainzToken: old.musicBrainzToken,
    youtubeMusicHeaders: old.type === OriginType.YOUTUBE_MUSIC ? formatCookiesAsHeaders(old.credential) : undefined,
  };
}
```

The `formatCookiesAsHeaders` helper converts Netscape-format cookies to a `cookie: <value>` header line.

---

## Future Enhancements

1. **Download queue UI** — popover showing progress of multiple simultaneous downloads
2. **Manual candidate selection** — show ranked options and let user pick
3. **Batch download** — download entire album/playlist at once
4. **Audio format selection** — configurable format (m4a/opus/flac) and quality
5. **Background download** — downloads continue even if user navigates away
6. **Offline-first** — automatically replace online songs with downloaded versions
7. **Capacitor Android** — integrate yt-dlp via termux or native module
