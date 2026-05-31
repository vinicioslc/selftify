# Spec: MusicBrainz Search & Metadata Enrichment

> **Status**: implemented  
> **Created**: 2026-05-30  
> **Target**: `selftify` — MusicBrainz integration for search, metadata, and cover art

---

## Problem

Selftify had two music sources (YouTube Music, Local Files) with no access to MusicBrainz metadata (MBIDs, release dates, genres, cover art). The `Origin` type already had unused fields (`musicBrainzToken`, `useMusicBrainz`, `musicBrainzSearchMode`, `linkedOriginId`) but no code used them. Local files with incomplete ID3 tags had no way to enrich metadata. Search results from YouTube Music lacked album/artist MBIDs for external linking or cross-referencing.

Users needed:
1. **Search** MusicBrainz directly as a third source
2. **Augment** local origin search with MusicBrainz results in "mixed" mode
3. **Extract** MBIDs from local file ID3 tags during scan
4. **Navigate** from MusicBrainz search results to artist/album detail pages
5. **Cache** MusicBrainz API responses to avoid rate-limit penalties (~1.2s/req)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SearchPage                                     │
│                                                                          │
│  musicBrainzSearchMode:                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐                 │
│  │ "youtube" │  │ "musicbrainz"│  │     "mixed"        │                 │
│  │ (default) │  │ (só MB)     │  │ (controller + MB)  │                 │
│  └────┬─────┘  └──────┬───────┘  └─────────┬──────────┘                 │
│       │               │                     │                            │
│       ▼               ▼                     ▼                            │
│  getController()  MusicBrainzClient   controller.search()                │
│  .search()        .search*()        + MusicBrainzClient                  │
│                                       .search*()                        │
│                                       (dedup por nome+artista)           │
└─────────────────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐   ┌──────────────────────────┐
│ getController() │   │ musicbrainz-client.ts     │
│ (current origin)│   │ (MB API client)           │
│                 │   │                           │
│ ┌─────────────┐ │   │ ┌─────────────────────┐  │
│ │ YouTube     │ │   │ │  Rate Limiter Queue  │  │
│ │ Controller  │ │   │ │  (1.2s entre reqs)  │  │
│ ├─────────────┤ │   │ ├─────────────────────┤  │
│ │ Local       │ │   │ │  Cache Layer        │  │
│ │ Controller  │ │   │ │  (LRU + Dexie)      │  │
│ ├─────────────┤ │   │ ├─────────────────────┤  │
│ │ MusicBrainz │ │   │ │  searchRecordings() │  │
│ │ Controller  │ │   │ │  searchReleases()   │  │
│ └─────────────┘ │   │ │  searchArtists()    │  │
└─────────────────┘   │ │  getReleaseDetail() │  │
                       │ │  getArtistDetail() │  │
                       │ │  getCachedCoverUrl │  │
                       │ └─────────────────────┘  │
                       └──────────────────────────┘
```

---

## Domain Types

### New `OriginType.MUSICBRAINZ`

```typescript
// src/types/domain-types.ts
enum OriginType {
  JELLYFIN = "jellyfin",
  NAVIDROME = "navidrome",
  SUBISONIC = "subsonic",
  YOUTUBE_MUSIC = "youtubemusic",
  LOCAL = "local",
  MUSICBRAINZ = "musicbrainz",   // <-- new
}
```

### MBID fields on domain types

```typescript
type Song = {
  // ...existing fields...
  mbzRecordingId?: string;   // MusicBrainz Recording ID
  mbzTrackId?: string;       // MusicBrainz Track ID
};

type Album = {
  // ...existing fields...
  mbzId?: string;             // MusicBrainz Release ID
  mbzReleaseGroupId?: string; // MusicBrainz Release Group ID
};

type AlbumArtist = {
  // ...existing fields...
  mbz?: string;               // MusicBrainz Artist ID
};
```

### MBID fields on `DbSong`

```typescript
// src/services/local-database-types.ts
type DbSong = {
  // ...existing fields...
  mbz_recording_id: string | null;
  mbz_track_id: string | null;
  mbz_album_id: string | null;
  mbz_release_group_id: string | null;
  mbz_artist_id: string | null;
};
```

### Existing `Origin` fields (now functional)

```typescript
type Origin = {
  // ...existing fields...
  musicBrainzToken?: string;                              // API key (increases rate limit to ~50 req/s)
  musicBrainzSearchMode?: "mixed" | "musicbrainz" | "youtube";  // search mode
  useMusicBrainz?: boolean;                               // master toggle
  linkedOriginId?: string;                                // cross-origin linking
};
```

---

## MusicBrainz API Client

### File: `src/services/musicbrainz-client.ts`

A REST client for the MusicBrainz API (`musicbrainz.org/ws/2`) with built-in rate limiting and caching.

### Rate Limiter

```typescript
const RATE_LIMIT_MS = 1200;   // 1.2s between requests (MusicBrainz requirement)

// Queue-based rate limiter:
//   enqueueRequest(url, init) → Promise<Response>
//   → Fila FIFO com delay de 1.2s entre requests
//   → Processa um request por vez
```

### Public API

| Function | Endpoint | Purpose |
|---|---|---|
| `searchRecordings(artist, recording, opts)` | `GET /ws/2/recording/?query=artist:X+AND+recording:Y` | Find recordings by artist + title |
| `searchReleases(artist, release, opts)` | `GET /ws/2/release/?query=artist:X+AND+release:Y` | Find releases (albums) by artist + title |
| `searchArtists(artist, opts)` | `GET /ws/2/artist/?query=artist:X` | Find artists by name |
| `getReleaseDetail(releaseMbid)` | `GET /ws/2/release/{mbid}?inc=artist-credits+recordings` | Release detail with track listing |
| `getRecordingDetail(recordingMbid)` | `GET /ws/2/recording/{mbid}?inc=artist-credits+releases` | Recording detail with release info |
| `getArtistDetail(artistMbid)` | `GET /ws/2/artist/{mbid}` | Artist detail |
| `getCachedCoverUrl(releaseMbid)` | `coverartarchive.org/release/{mbid}/front-250.jpg` | Cover art (cached in image-cache) |

### Query Builder

```typescript
function buildQuery(terms: Record<string, string>): string
// Ex: { artist: "Pink Floyd", recording: "Comfortably Numb" }
// → 'artist:"Pink Floyd" AND recording:"Comfortably Numb"'
// Valores vazios são filtrados
```

### Cover Art Caching

```typescript
async function getCachedCoverUrl(releaseMbid: string): Promise<string | null>
// 1. Check image-cache for tag "mbz-cover/{releaseMbid}" → HIT → return blob URL
// 2. MISS → fetch coverartarchive.org
// 3. storeImage(blob, format, ["mbz-cover/{releaseMbid}"])
// 4. Return blob URL from image-cache
```

---

## Cache System

### File: `src/services/musicbrainz-cache.ts`

Three-layer cache to minimize MusicBrainz API calls (critical because of 1.2s rate limit).

### Layer 1: LRU in Memory (session-only)

```typescript
const metadataLru = new Map<string, { data: object; ts: number }>();
// max 500 entries
// Key: "rel-{mbid}" | "rec-{mbid}" | "art-{mbid}"
// No TTL (MBID→metadata mapping is immutable)

const searchLru = new Map<string, { data: object; ts: number }>();
// max 200 entries
// Key: hash da query
// TTL: 5 minutos (resultados de busca podem mudar)
```

### Layer 2: Dexie (persistent, survives reload)

Dexie version 3 adds two new stores:

```
mbz_metadata_cache: "key"              // key → JSON data + cached_at timestamp
mbz_search_cache:   "key, expires_at"  // key → JSON data + expiry timestamp (5 min TTL)
```

### Layer 3: Image Cache (IndexedDB)

Existing `image-cache.ts` with new tag pattern:
```
"mbz-cover/{releaseMbid}"   → cover art from Cover Art Archive
```

### Flow Decision

```
Request (mbid lookup or search)
  │
  ├─► LRU em memória ──► HIT ──► return (0ms)
  │
  └─► MISS
       │
       ├─► Dexie cache ──► HIT ──► popula LRU ──► return (5ms)
       │
       └─► MISS
            │
            ├─► Rate limiter queue (wait 1.2s)
            ├─► fetch() MusicBrainz API (~300-800ms)
            ├─► salva Dexie (persistent)
            ├─► salva LRU (session)
            └─► return
```

### API

```typescript
hashSearchQuery(params): string                // hash determinístico para cache de busca
getCachedMetadata<T>(key): Promise<T | null>   // LRU + Dexie lookup
setCachedMetadata(key, data): Promise<void>    // LRU + Dexie write
getCachedSearch<T>(key): Promise<T | null>     // LRU + Dexie lookup (com validação TTL)
setCachedSearch(key, data): Promise<void>      // LRU + Dexie write (com TTL de 5 min)
clearExpiredSearchCache(): Promise<void>       // limpa entradas expiradas
clearAllCaches(): Promise<void>                // limpa tudo (LRU + Dexie)
```

---

## MusicBrainz Controller

### File: `src/api/musicbrainz/musicbrainz-controller.ts`

Implements `ServerController` interface for `OriginType.MUSICBRAINZ`. Used for direct MusicBrainz search and for navigating MusicBrainz results.

### Implementation

```typescript
function createMusicBrainzController(ctx: ApiContext): ServerController
```

| Method | Implementation | Notes |
|---|---|---|
| `authenticate()` | Returns `{token: "mbz", username: "MusicBrainz"}` | No real auth needed |
| `search(query, limit)` | Parallel: `searchRecordings(q, q)`, `searchReleases(q, q)`, `searchArtists(q)` | Returns songs + albums + artists |
| `getAlbumDetail(id)` | `getReleaseDetail(mbid)` | |
| `getAlbumSongs(artist, album)` | `searchRecordings(artist, album)` + cover art resolution | |
| `getAlbumArtistDetail(id)` | `getArtistDetail(mbid)` | |
| `getArtistSongs(artist)` | `searchRecordings(artist, "", {limit: 50})` + cover art resolution | Album names from `releases[0].title` |
| `getImageUrl(songId)` | `getCachedCoverUrl(mbid)` for release IDs | Cover art from Cover Art Archive |
| `getSongDetail()` / `getAlbumList()` / `getSongList()` / `getStreamUrl()` / `getPlaylist*()` | Return `null` or `[]` | Not applicable |

### Recording → Song mapping

```typescript
function recordingToSong(ctx, rec): Song
// MB recording.search API retorna:
//   { id, title, length, "artist-credit": [...], releases: [{id, title}] }
//
// Mapeia para Song:
//   name: rec.title
//   artistName: artist-credit[0].name
//   albumName: releases[0].title  (primeiro release listado)
//   albumId: "mbz-release-{releases[0].id}"
//   mbzRecordingId: rec.id
//   mbzTrackId: rec.id
```

---

## Controller Factory

### File: `src/api/controller.ts`

```typescript
export async function getController(originType?: OriginType): Promise<ServerController>
// Sem argumento: usa currentOrigin (comportamento original)
// Com OriginType.MUSICBRAINZ: cria contexto sintético (não precisa de origin real)
// Outros types: usa currentOrigin (fallback)
```

### Synthetic Context

When `getController(OriginType.MUSICBRAINZ)` is called, a minimal `ApiContext` is created:

```typescript
ctx = {
  originId: `synthetic-${originType}`,
  originType,
}
```

This allows the MusicBrainz controller to be used without requiring the user to configure a MusicBrainz "origin" in settings.

---

## Search Augmentation

### File: `src/features/search/search-page.tsx`

The `handleSearch()` function respects `musicBrainzSearchMode`:

```
musicBrainzSearchMode:
  "youtube" (default):
    → getController().search(query, 20)
    → Busca apenas no controller da origem atual

  "musicbrainz":
    → searchMusicBrainz(query, 20)
    → Busca apenas na API do MusicBrainz
    → Mapeia recordings → Song (com albumName de releases[0].title)
    → Mapeia releases → Album
    → Mapeia artists → AlbumArtist

  "mixed":
    → Parallel: (controller.search + searchMusicBrainz)
    → Merge resultados:
      - Songs: controller + MB (dedup por nome+artista.toLowerCase)
      - Albums: controller (priority) senão MB
      - Artists: controller (priority) senão MB
```

### `searchMusicBrainz()` helper

```typescript
async function searchMusicBrainz(q, limit): Promise<SearchResults>
// 1. searchRecordings(q, q, {limit})       → recordings → Songs (com albumName)
// 2. searchReleases(q, q, {limit: 5})      → releases → Albums
// 3. searchArtists(q, {limit: 5})          → artists → AlbumArtists
// 4. Return { songs, albums, albumArtists }
```

---

## Local File MBID Extraction

### File: `src/api/indexer/local-indexer.ts`

`music-metadata` already returns MBID fields in `common`:

```typescript
const c = result.common;
// c.musicbrainz_recordingid?: string
// c.musicbrainz_trackid?: string
// c.musicbrainz_albumid?: string
// c.musicbrainz_artistid?: string[]
// c.musicbrainz_releasegroupid?: string
```

The indexer was modified to:
1. Extract these fields from the music-metadata parse result
2. Store them in `DbSong` (`mbz_recording_id`, `mbz_track_id`, `mbz_album_id`, `mbz_release_group_id`, `mbz_artist_id`)
3. The `local-controller.ts` `toSong()` function propagates them to the domain `Song` type (`mbzRecordingId`, `mbzTrackId`)

### Dexie Migration

Dexie version 2 added indexed fields for MBID lookups:

```
version 2: songs: "..., mbz_album_id, mbz_artist_id, mbz_recording_id"
```

---

## Navigation Flow (MusicBrainz Items)

### Problem

When a user clicks a MusicBrainz artist/album in search results, the `ArtistPage`/`AlbumPage` calls `getController()` which returns the **current origin's controller** (e.g., YouTube), not the MusicBrainz controller.

### Fix: `getController(originType?)`

```typescript
// controller.ts
export async function getController(originType?: OriginType): Promise<ServerController>
```

### Fix: ArtistPage passes originType

```typescript
// artist-page.tsx
const controller = await getController(
  artist.originType === OriginType.MUSICBRAINZ ? OriginType.MUSICBRAINZ : undefined
);
const allSongs = await controller.getArtistSongs(artist.name);
```

### Fix: AlbumPage passes originType

```typescript
// album-page.tsx
const controller = await getController(
  album.originType === OriginType.MUSICBRAINZ ? OriginType.MUSICBRAINZ : undefined
);
const result = await controller.getAlbumSongs(album.albumArtistName, album.name);
```

### Fix: handleNavigateFromArtist preserves originType

```typescript
// App.tsx
function handleNavigateFromArtist(albumName, artistName) {
  const album: Album = {
    id: `album-...`,
    originId: selectedArtist?.originId || currentOrigin?.id || "",
    originType: selectedArtist?.originType || currentOrigin?.type || OriginType.LOCAL,
    // ...
  };
}
```

### Navigation Flow Diagram

```
SearchPage → clique em artista MusicBrainz
  │
  ▼
onNavigateArtist(artist: { originType: MUSICBRAINZ, ... })
  │
  ▼
App.tsx handleNavigateArtist
  → selectedArtist = artist
  → setCurrentView("artist-detail")
  │
  ▼
ArtistPage
  → getController(OriginType.MUSICBRAINZ)
  → getArtistSongs(artist.name)
  → searchRecordings(name, "", {limit: 50})
  → Songs com albumName = releases[0].title
  → Agrupa por albumName → mostra álbuns nomeados ✓
  │
  ▼
Clique em álbum no ArtistPage
  → onNavigateAlbum(albumName, artistName)
  │
  ▼
App.tsx handleNavigateFromArtist
  → originType = selectedArtist.originType → MUSICBRAINZ
  │
  ▼
AlbumPage
  → getController(OriginType.MUSICBRAINZ)
  → getAlbumSongs(artist, album)
  → searchRecordings(artist, album, {limit: 50})
  → Songs com albumName correto ✓
```

---

## Files Summary

### New Files

| File | Purpose |
|---|---|
| `src/services/musicbrainz-types.ts` | Types for MusicBrainz API responses (`MBRecording`, `MBRelease`, `MBArtist`) |
| `src/services/musicbrainz-client.ts` | REST client with rate limiting + Dexie/LRU caching. Search, detail, and cover art functions |
| `src/services/musicbrainz-cache.ts` | LRU in-memory cache + Dexie persistent cache for MBID metadata and search queries |
| `src/api/musicbrainz/musicbrainz-controller.ts` | `ServerController` implementation for `OriginType.MUSICBRAINZ` |

### Modified Files

| File | Change |
|---|---|
| `src/types/domain-types.ts` | Add `OriginType.MUSICBRAINZ`, MBID fields on `Song`/`Album`/`AlbumArtist` |
| `src/services/local-database-types.ts` | Add MBID fields on `DbSong`, `MbzMetadataCache`, `MbzSearchCache` types |
| `src/services/local-database.ts` | Dexie version 2 (MBID indexes on songs), version 3 (cache tables) |
| `src/api/indexer/local-indexer.ts` | Extract `musicbrainz_*` fields from `music-metadata` parse, store in `DbSong` |
| `src/api/local/local-controller.ts` | Propagate `mbzRecordingId`/`mbzTrackId` in `toSong()` |
| `src/api/controller.ts` | `getController(originType?)` accepts optional override; add `OriginType.MUSICBRAINZ` case |
| `src/features/search/search-page.tsx` | `searchMusicBrainz()` helper; `handleSearch()` respects `musicBrainzSearchMode`; songs include `albumName` from releases |
| `src/features/artist/artist-page.tsx` | Pass `artist.originType` to `getController()` |
| `src/features/album/album-page.tsx` | Pass `album.originType` to `getController()` |
| `src/App.tsx` | `handleNavigateFromArtist` preserves `selectedArtist.originType`/`originId` |

---

## Dependencies

**None new.** All MusicBrainz interactions use:

| Technology | Used for |
|---|---|
| `fetch()` (browser/Electron native) | REST calls to `musicbrainz.org/ws/2` and `coverartarchive.org` |
| `crypto.subtle.digest("SHA-256")` | Content hashing in `image-cache.ts` |
| `indexedDB` (via Dexie) | Song storage + MBID cache (persistent) |
| `URL.createObjectURL()` | Blob URL generation for cached images |
| `music-metadata` (existing dep) | Extract MBID fields from ID3/Vorbis tags |

---

## Edge Cases & States

| State | Behavior |
|---|---|
| **MusicBrainz search with no internet** | `searchMusicBrainz()` catch → returns `{songs:[], albums:[], artists:[]}`, no crash |
| **Recording with no releases** | `albumName` = undefined → ArtistPage groups under "Other" |
| **Artist with no recordings** | ArtistPage shows loading → "No songs found for this artist." |
| **"youtube" search mode** | Only current origin searched (backward compatible) |
| **"musicbrainz" search mode** | Only MusicBrainz API searched (even if origin is YouTube/Local) |
| **"mixed" search mode** | Both origins, dedup by `name+artistName.toLowerCase` |
| **getController(MUSICBRAINZ) without MB token** | Works fine — rate limit stays at 1.2s (no token needed for basic access) |
| **Cover Art Archive 404** (no cover for release) | `getCachedCoverUrl()` returns `null`, image stays null |
| **MBID in local file tags** | Extracted during scan, stored in Dexie, propagated to Song.mbzRecordingId |
| **File without MBID tags** | Fields are `null` in DbSong, `undefined` in Song (no error) |
| **Dexie version migration from v1 to v3** | Dexie handles upgrade path automatically; missing MBID columns default to `undefined` |
| **Rate limit exceeded** (API returns 503) | Exception caught by controller → empty results |
| **Multiple releases for same recording** | Uses `releases[0]` (first/canonical release) |

---

## Future Enhancements

1. **MusicBrainz token support**: Use token for higher rate limit (~50 req/s instead of 1)
2. **AcoustID fingerprinting**: Audio fingerprint → MusicBrainz match for unknown local files
3. **Metadata enrichment on scan**: After MBID extraction from tags, auto-fetch missing metadata via MusicBrainz API
4. **ListenBrainz scrobbling**: Submit plays using MBIDs
5. **Discord Rich Presence**: Show MusicBrainz links in Discord status
6. **Release grouping**: Show all releases for an artist (albums, singles, EPs, compilations)
7. **External links**: Show MusicBrainz icon + link on album/artist detail pages
