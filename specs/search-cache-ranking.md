# Search Cache & Ranking

## Problem

- Every MusicBrainz search and YouTube Pure search re-fetches results, even for identical queries.
- Every musicbrainz song play goes through full search + ranking (8-15s), even if the same song was played before.
- There is no visibility into what is cached, what was ranked, or how ranking decisions were made.
- Timeouts for yt-dlp operations are hardcoded and not user-configurable.

## Solution

### 1. Search Result Cache (by query text)

Persist search results keyed by `provider:normalizedQuery` across restarts using Dexie.

| Table | Key | Data | TTL |
|---|---|---|---|
| `search_cache` | `provider:normalized_query` | `{ songs: Song[], albums: Album[], albumArtists: AlbumArtist[], createdAt: number }` | Configurable (default 1h), cleaned on startup |
| `mbz_yt_mapping` | `mbz_recording_id` | `{ selectedVideoId, selectedType, candidates: CandidateData[], songName, artistName, albumName, albumImageUrl, createdAt, updatedAt }` | Permanent (user can clear) |

`normalized_query` = `query.trim().toLowerCase().replace(/\s+/g, ' ')`

**Flow**:
```
searchYouTubePure(q) → cache.get("youtube-pure:<normQ>") → miss → yt-dlp → cache.set → return
searchMusicBrainz(q) → cache.get("musicbrainz:<normQ>") → miss → MB API → cache.set → return
```

Cache invalidation: TTL expiry, manual clear (modal), clear on settings change.

### 2. MusicBrainz → YouTube Video Mapping

When `searchAndRank()` finds a match for a MusicBrainz song, save the mapping.
When playing a MusicBrainz song, check mapping first → if found, go straight to `getStreamUrl(videoId)`, skipping search+ranking entirely.

**Impact**: Second play of the same song: **0-3s** instead of **8-15s**.

**Schema**:
```
mbzRecordingId: string (PK)
selectedVideoId: string         // videoId atualmente selecionado
selectedType: "auto"|"manual"|"custom"  // como foi selecionado
candidates: string              // JSON.stringify(CandidateData[])
songName: string
artistName: string
albumName?: string
albumImageUrl?: string | null   // CoverArtArchive URL
customVideoId?: string          // se foi URL custom colada pelo usuario
customVideoUrl?: string         // URL original colada pelo usuario
createdAt: number
updatedAt: number               // ultima alteracao de selecao
```

**Cleanup**: User can delete individual mappings or clear all via CacheManagerModal. LRU-like eviction is not needed (storage is trivial).

### 3. Configurable Timeouts

Add to the existing Network tab in Settings:

| Field | Store Key | Type | Default | Slider Range |
|---|---|---|---|---|
| Search timeout (ms) | `searchTimeoutMs` | number | 60000 | 5000–120000 |
| Stream timeout (ms) | `streamTimeoutMs` | number | 60000 | 5000–120000 |
| Cache TTL (min) | `cacheTtlMinutes` | number | 60 | 1–1440 |

These are passed to `execYtDlp` in the main process via IPC payload.

### 4. Cache Manager Modal

Opened from Network tab. Shows cached queries grouped by provider (MusicBrainz, YouTube Pure, Local) and MB→YT mappings.

Each group shows a table with: query text, result count, cached timestamp, actions (delete single / delete all).

### 5. Ranking Tab

New tab in Settings page:

- **Configuration**: Weight sliders for title/artist/album/duration matching
- **History**: Table of last 50 ranking decisions: query, winner, scores, timestamp
- **Actions**: Clear history

## Files Changed

| File | Change |
|---|---|
| `src/services/search-cache.ts` | **Create** — Dexie tables + CRUD helpers. Schema expandido: `MbzYtMapping` armazena todos os candidatos (`candidates: CandidateData[]`), tipo de selecao (`selectedType`), e metadados da musica |
| `src/services/youtube-download-service.ts` | Modify — `searchAndRank` salva todos os candidatos no mapping. `getStreamUrl` verifica `selectedVideoId` salvo antes de fazer auto-ranking |
| `src/services/youtube-ranking.ts` | Modify — configurable weights + `recordRanking()` |
| `src/services/youtube-ranking.ts` | Modify — configurable weights + `recordRanking()` |
| `src/features/search/search-page.tsx` | Modify — cache search results before/after fetch |
| `src/stores/settings.store.ts` | Modify — add search/stream/cache settings |
| `src/features/settings/settings-page.tsx` | Modify — add Ranking tab + cache + timeout fields |
| `src/features/settings/cache-manager-modal.tsx` | **Create** — modal for cache inspection |
| `src/features/settings/ranking-view.tsx` | **Create** — ranking config + history |
| `electron/main.ts` | Modify — `yt:search` / `yt:stream-url` accept `timeout` in payload |
