# Search Cache & Ranking — API & Data

## Database Tables (Dexie)

### `search_cache`

```
key: string             // "musicbrainz:<norm_query>" | "youtube-pure:<norm_query>"
songs: string           // JSON-stringified Song[]
albums: string          // JSON-stringified Album[]
albumArtists: string    // JSON-stringified AlbumArtist[]
createdAt: number       // Date.now()
```

Indexes: `key` (unique), `createdAt`.

### `mbz_yt_mapping`

```
mbzRecordingId: string   // PK
selectedVideoId: string  // videoId atualmente selecionado (auto-ranking ou escolha manual)
selectedType: string     // "auto" | "manual" | "custom"
candidates: string       // JSON-stringified CandidateData[] (todos os candidatos do ranking)
songName: string         // denormalizado para display
artistName: string
albumName?: string
albumImageUrl?: string | null
customVideoId?: string   // se selectedType = "custom"
customVideoUrl?: string  // URL original colada pelo usuario
createdAt: number
updatedAt: number
```

```ts
// CandidateData (serializavel)
type CandidateData = {
  videoId: string
  title: string
  uploader?: string
  duration?: number
  thumbnailUrl?: string | null
  score: number
  titleMatch: boolean
  artistMatch: boolean
  albumMatch: boolean
  exactDuration: boolean
  closestDuration: boolean
  diff: number
  source: "ranking" | "custom"
};
```

Indexes: `mbzRecordingId` (unique), `selectedType`, `updatedAt`.

### `ranking_log`

```
id: number              // auto-increment PK
query: string           // "Artist - Song"
winnerId: string
winnerTitle: string
winnerUploader: string
score: number
scores: string          // JSON: { titleMatch, artistMatch, albumMatch, exactDuration, closestDuration }
candidates: number      // total candidates considered
createdAt: number
```

Indexes: `id` (auto-increment), `createdAt`.

## Store Shape (settings.store.ts)

New fields in `SettingsState`:

```ts
searchTimeoutMs: number          // default 60000
streamTimeoutMs: number          // default 60000
cacheTtlMinutes: number          // default 60
rankingWeights: {
  title: number                  // default 1.0
  artist: number                 // default 0.5
  album: number                  // default 1.0
  duration: number               // default 0.5
}
```

Setters: `setSearchTimeoutMs`, `setStreamTimeoutMs`, `setCacheTtlMinutes`, `setRankingWeights`.

## IPC Changes

### `yt:search` payload

Extends payload from `string` to `{ query: string; timeout?: number }`.

When the caller passes a timeout, `execYtDlp` uses it instead of the hardcoded default.

### `yt:stream-url` payload

Extends payload from `string` to `{ videoId: string; timeout?: number }`.

## Exports from search-cache.ts

```ts
export async function getSearchCache(provider: string, query: string): Promise<SearchResults | null>
export async function setSearchCache(provider: string, query: string, results: SearchResults): Promise<void>
export async function clearSearchCache(provider?: string): Promise<void>
export async function deleteSearchCache(key: string): Promise<void>
export async function getAllSearchCacheEntries(): Promise<CacheEntry[]>

// MbzYtMapping — schema expandido com todos os candidatos
export async function getMbzYtMapping(mbzRecordingId: string): Promise<MbzYtMapping | null>
export async function setMbzYtMapping(mapping: MbzYtMapping): Promise<void>
export async function deleteMbzYtMapping(mbzRecordingId: string): Promise<void>
export async function getAllMbzYtMappings(): Promise<MbzYtMapping[]>
export async function clearAllMbzYtMappings(): Promise<void>

export async function recordRanking(entry: Omit<RankingLogEntry, 'id'>): Promise<void>
export async function getRecentRankings(limit?: number): Promise<RankingLogEntry[]>
export async function clearRankingLog(): Promise<void>
export async function pruneExpiredCache(ttlMs: number): Promise<void>
```
