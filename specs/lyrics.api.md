# Lyrics Feature — API & Data Spec

## Type Definitions

### `src/types/lyrics-types.ts`

```typescript
export enum LyricSource {
  LRCLIB = "lrclib.net",
  NETEASE = "NetEase",
}

export type SynchronizedLyricsArray = Array<[number, string]>; // [timeMs, text]

export type LyricsResponse = string | SynchronizedLyricsArray;

export type LyricSearchQuery = {
  album?: string;
  artist?: string;
  duration?: number;
  name?: string;
};

export type LyricSearchResult = {
  artist: string;
  id: string;
  isSync: boolean | null;
  name: string;
  score?: number;
  source: LyricSource;
};

export type LyricGetQuery = {
  remoteSongId: string;
  remoteSource: LyricSource;
};

export type LyricOverride = {
  artist: string;
  id: string;
  name: string;
  remote: boolean;
  source: string;
};

export type FullLyricsMetadata = {
  artist: string;
  lyrics: LyricsResponse;
  name: string;
  offsetMs?: number;
  remote: boolean;
  source: string;
};

export type LyricsQueryResult = {
  local: FullLyricsMetadata | null;
  overrideData: LyricsResponse | null;
  overrideSelection: LyricOverride | null;
  remoteAuto: FullLyricsMetadata | null;
  selected: FullLyricsMetadata | null;
  selectedOffsetMs: number;
  selectedSynced: boolean;
  suppressRemoteAuto: boolean;
};
```

### Domain Types — Additions to `src/types/domain-types.ts`

On `Song` type, add:

```typescript
export type Song = {
  // ... existing fields ...
  lyricsEmbedded?: string;       // from MP3 tag (FileTags.lyrics)
  lyricsPath?: string;           // path to .lrc sidecar file
  lyricsCache?: string;          // cached lyrics text (LRC or plain)
  lyricsCacheType?: "lrc" | "plain" | null; // type of cached lyrics
};
```

### Settings — Additions to `src/stores/settings.store.ts`

```typescript
export type LyricsSettings = {
  fetch: boolean;
  sources: LyricSource[];
  preferLocalLyrics: boolean;
  alignment: "center" | "left" | "right";
  follow: boolean;
  showProvider: boolean;
  showMatch: boolean;
  fontSize: number;       // synced
  fontSizeUnsync: number; // unsynced
  gap: number;            // synced
  gapUnsync: number;      // unsynced
  delayMs: number;        // global offset
  enableNeteaseTranslation: boolean;
};
```

Default values:
```typescript
const DEFAULT_LYRICS_SETTINGS: LyricsSettings = {
  fetch: true,
  sources: [LyricSource.NETEASE, LyricSource.LRCLIB],
  preferLocalLyrics: false,
  alignment: "center",
  follow: true,
  showProvider: true,
  showMatch: true,
  fontSize: 24,
  fontSizeUnsync: 24,
  gap: 24,
  gapUnsync: 24,
  delayMs: 0,
  enableNeteaseTranslation: false,
};
```

## Store Shape — `src/stores/lyrics.store.ts`

```typescript
type LyricsState = {
  currentResult: LyricsQueryResult | null;
  isLoading: boolean;
  error: string | null;

  setCurrentResult: (result: LyricsQueryResult | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
};
```

- **Not persisted** (volatile per session)
- Used primarily as a thin cache for the currently displayed lyrics between re-renders
- React Query is the primary cache; this store provides synchronous access for components that need it

## Provider Interface

### `src/services/lyrics/providers/`

All providers implement:

```typescript
interface LyricsProvider {
  readonly name: LyricSource;
  search(params: LyricSearchQuery): Promise<LyricSearchResult[]>;
  getLyrics(id: string): Promise<string | null>;
}
```

### LRCLib Provider

| Aspect | Detail |
|--------|--------|
| Search URL | `GET https://lrclib.net/api/search?q={query}` |
| Get URL | `GET https://lrclib.net/api/get/{id}` |
| Auth | User-Agent header: `"Selftify/1.0 (https://github.com/vinicioslc/selftify)"` |
| Timeout | 5000ms |
| Response fields | `id`, `name`, `artistName`, `albumName`, `duration`, `instrumental`, `plainLyrics`, `syncedLyrics` |
| Fallback | `syncedLyrics || plainLyrics || null` |
| Instrumental | Return null if `instrumental === true` |

### NetEase Provider

| Aspect | Detail |
|--------|--------|
| Search URL | `GET https://music.163.com/api/search/get?s={query}&type=1&limit=5` |
| Get URL | `GET https://music.163.com/api/song/lyric?id={id}&kv=-1&lv=-1&tv=-1` |
| Auth | None |
| Timeout | 5000ms |
| Response fields (search) | `result.songs[].id`, `.name`, `.artists[].name` |
| Response fields (lyrics) | `lrc.lyric` (original), `tlyric.lyric` (translated) |
| NetEase translation | If enabled in settings, merge original + translated via `_BREAK_` delimiter |
| Merge strategy | Parse both LRCs, match by timestamp, append `_BREAK_translated` |

## Service Layer — `src/services/lyrics/lyrics-service.ts`

```typescript
class LyricsService {
  async getLyrics(song: Song): Promise<FullLyricsMetadata | null>;
  async searchAll(query: LyricSearchQuery): Promise<Record<LyricSource, LyricSearchResult[]>>;
  async getLocalLyrics(song: Song): Promise<FullLyricsMetadata | null>;
  async getRemoteLyrics(song: Song): Promise<FullLyricsMetadata | null>;
  async getRemoteLyricsById(query: LyricGetQuery): Promise<string | null>;
}
```

### Methods

| Method | Input | Output | Behavior |
|--------|-------|--------|----------|
| `getLyrics` | `Song` | `FullLyricsMetadata \| null` | 1) Check local (embedded + .lrc) 2) Fetch remote 3) Rank 4) Return best |
| `searchAll` | `LyricSearchQuery` | `Record<LyricSource, LyricSearchResult[]>` | Search all enabled providers in parallel |
| `getLocalLyrics` | `Song` | `FullLyricsMetadata \| null` | Check `song.lyricsEmbedded` then `song.lyricsPath` |
| `getRemoteLyrics` | `Song` | `FullLyricsMetadata \| null` | Auto: search → rank → fetch best |
| `getRemoteLyricsById` | `LyricGetQuery` | `string \| null` | Fetch specific ID from specified source |

## LRC Parser — `src/services/lyrics/lrc-parser.ts`

```typescript
function parseLrc(lyrics: string): SynchronizedLyricsArray | string;
function formatLrc(array: SynchronizedLyricsArray, meta?: { artist?: string; title?: string; offset?: number }): string;
```

### Parsing Logic

| Pattern | Format | Example |
|---------|--------|---------|
| Standard LRC | `[mm:ss.SSS]text` | `[01:23.456]Hello world` |
| Short MS | `[mm:ss.SS]text` | `[01:23.45]Hello world` |
| NetEase karaoke | `[SSS,???]text` | `[12345,500]Hello world` |

If no pattern matches, return the raw string as-is (plain text).

### `_BREAK_` Delimiter

NetEase-merged translated lyrics use `_BREAK_` to separate original and translated text within a line. The `LyricLine` component splits on `_BREAK_` and renders each part as a separate `<span>`.

## IPC Channels — Electron

### `electron/preload.ts` — API Exposure

```typescript
window.electronApi.lyrics = {
  getRemoteLyricsBySong: (song: Song) => ipcRenderer.invoke("lyric:by-song", song),
  searchRemoteLyrics: (params: LyricSearchQuery) => ipcRenderer.invoke("lyric:search", params),
  getRemoteLyricsByRemoteId: (params: LyricGetQuery) => ipcRenderer.invoke("lyric:by-remote-id", params),
};
```

### `electron/main.ts` — IPC Handlers

| Channel | Handler | Returns |
|---------|---------|---------|
| `lyric:by-song` | `lyricsService.getRemoteLyrics(song)` | `FullLyricsMetadata \| null` |
| `lyric:search` | `lyricsService.searchAll(params)` | `Record<LyricSource, LyricSearchResult[]>` |
| `lyric:by-remote-id` | `lyricsService.getRemoteLyricsById(params)` | `string \| null` |

Each handler uses `platformFetch` (through the service layer, which is imported directly in main process).

Note: In Electron, the service layer runs in the main process. In web/Capacitor, it runs in the renderer. The `platformFetch` handles the difference transparently.

## React Query Integration

### Query Key Factory

```typescript
const lyricsKeys = {
  all: ["lyrics"] as const,
  bySong: (songId: string) => ["lyrics", "song", songId] as const,
  search: (query: LyricSearchQuery) => ["lyrics", "search", query] as const,
  byRemoteId: (query: LyricGetQuery) => ["lyrics", "remote", query] as const,
};
```

### Query Configuration

| Query | Stale Time | GC Time | Persist |
|-------|-----------|---------|---------|
| `songLyrics` | Infinity | Infinity | Yes (IndexedDB) |
| `lyricsSearch` | 60s | 60s | No |
| `songLyricsByRemoteId` | Infinity | Infinity | Yes (IndexedDB) |

## Data Transformations

### LRC → SynchronizedLyricsArray

```
Input:  "[01:23.456]Hello world\n[01:25.000]Second line"
Output: [[83456, "Hello world"], [85000, "Second line"]]
```

### NetEase Karaoke → SynchronizedLyricsArray

```
Input:  "[83456,500]Hello world"
Output: [[83456, "Hello world"]]
```

### SynchronizedLyricsArray → LRC String (for export)

```
Input:  [[83456, "Hello world"], [85000, "Second line"]]
Output: "[01:23.456]Hello world\n[01:25.000]Second line"

With meta:
Output: "[ar:Artist]\n[ti:Song]\n[offset:0]\n[01:23.456]Hello world\n[01:25.000]Second line"
```

## Offline/Error Handling

| Scenario | Behavior |
|----------|----------|
| No network | Return null for remote; local still works |
| Remote timeout (5s) | Return null for that provider |
| All providers fail | Return null → UI empty state |
| Partial success | Best ranked result used |
| Override saved | Persisted in React Query cache (IndexedDB) |
| Cache miss | Re-fetch on next song play |
