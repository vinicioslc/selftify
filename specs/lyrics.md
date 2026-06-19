# Lyrics Feature — Technical Spec

## Problem Statement

Display synchronized (karaoke-style) or plain-text lyrics for the currently playing song. Auto-fetch lyrics from internet providers (LRCLib, NetEase) with fallback to embedded MP3 tags or `.lrc` sidecar files from local library. Allow manual override search, timing offset adjustment, and export.

## Architecture

Clean architecture with four layers, matching the project's existing patterns:

```
┌─────────────────────────────────────────────────────────────┐
│                   PRESENTATION LAYER                         │
│  src/features/lyrics/ (React components)                    │
│  Orchestrator: lyrics-panel.tsx                              │
│  Children: synchronized-lyrics, unsynchronized-lyrics,       │
│            lyric-line, lyrics-actions                        │
├─────────────────────────────────────────────────────────────┤
│                  APPLICATION / STATE LAYER                   │
│  src/stores/lyrics.store.ts       — Zustand (current display)│
│  src/stores/settings.store.ts     — Extended with lyrics prefs│
│  @tanstack/react-query           — Async fetch caching       │
├─────────────────────────────────────────────────────────────┤
│                    SERVICE LAYER                              │
│  src/services/lyrics/                                        │
│  ├── lyrics-service.ts          — Orchestrates all fetching  │
│  ├── lrc-parser.ts              — LRC string ↔ typed arrays  │
│  ├── lrc-parser.test.ts         — Unit tests for parser      │
│  ├── providers/                                              │
│  │   ├── lrclib-provider.ts     — LRCLib API client          │
│  │   └── netease-provider.ts    — NetEase API client         │
│  └── lyrics-ranking.ts          — Fuse.js result ranking     │
├─────────────────────────────────────────────────────────────┤
│                  INFRASTRUCTURE LAYER                         │
│  electron/main.ts               — IPC handlers for 3 channels│
│  electron/preload.ts            — Expose lyrics API on window│
│  src/services/platform-fetch.ts — CORS-avoiding HTTP wrapper │
│  src/services/db/               — SQLite storage for local   │
│                                     lyrics cache + .lrc refs │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Auto-Fetch Flow (song changes)

```
1. Song changes → lyrics-panel detects via player.store.currentTrack
2. 500ms debounce (avoid rapid fetches on queue skip)
3. React Query fetcher triggered (lyricsQueries.songLyrics)
4. Fetcher calls lyrics-service.getLyrics(song):
   a. Check local SQLite cache for stored lyrics (from embedded/.lrc)
   b. Also fetch remote from providers (LRCLib + NetEase in parallel)
   c. Rank results via Fuse.js → pick best match (threshold 0.55)
   d. Parse LRC string if synced → return SynchronizedLyricsArray
   e. Dispatch status message via useStatusStore
5. lyrics-panel receives result → renders synced or unsynced
6. Synchronized lyrics start karaoke engine with current playback position
```

### Manual Override Flow (user clicks "Search")

```
1. User clicks "Search" → LyricsSearchModal opens
2. Pre-filled song name + artist inputs (debounced 500ms)
3. React Query fetcher calls lyrics-service.searchAll(songName, artist)
4. Providers searched in parallel → results merged + ranked
5. User clicks result → preview fetched via fetchRemoteLyricsById
6. User clicks "Apply" → override stored in React Query cache
```

### Local Lyrics Flow (embedded MP3 + .lrc sidecar)

```
1. During file scan (local-indexer.ts):
   a. Parse tags → FileTags.lyrics stored in song.lyrics_embedded
   b. Check for .lrc sidecar → path stored as song.lyrics_path
2. During playback, lyrics-service.getLocalLyrics(song):
   a. If song.lyrics_embedded → parse LRC (if applicable) → return
   b. If song.lyrics_path → read file → parse LRC → return
   c. Both cached in SQLite for fast subsequent access
```

## Component Tree

```
FullScreenPlayer (or NowPlayingPage)
  └── Tabs: Queue | Lyrics | Visualizer
        └── LyricsPanel
              ├── [Loading] Spinner
              ├── [Empty]  "No lyrics found" + fade-out + Search button
              ├── [Synced] SynchronizedLyrics
              │     ├── Credit lines ("Provided by {source}")
              │     ├── LyricLine[] (active highlighted, auto-scroll)
              │     └── click-to-seek handler
              └── [Plain]  UnsynchronizedLyrics
                    ├── Credit lines
                    └── LyricLine[] (static scrollable)
              └── LyricsActions
                    ├── Search button → LyricsSearchModal
                    ├── Offset controls (-50 / input / +50)
                    ├── Clear/Refresh button
                    └── Export button → LyricsExportModal
```

## Provider Interface

All providers implement the same interface:

```typescript
interface LyricsProvider {
  readonly name: LyricSource;
  search(params: LyricSearchQuery): Promise<LyricSearchResult[]>;
  getLyrics(id: string): Promise<string | null>;
}
```

## Platform Strategy: platformFetch

All network calls use `platformFetch` from `src/services/platform-fetch.ts` (not Electron IPC directly). This ensures lyrics work on all platforms:

- **Electron**: Routes through IPC → main process → HTTP (no CORS)
- **Capacitor/Android**: Uses CapacitorHttp native client (no CORS)
- **Web**: Falls back to `globalThis.fetch` (providers must support CORS; LRCLib does)

## Error Handling

| Scenario | Behavior |
|----------|----------|
| All providers fail | Return null → UI shows "No lyrics found" |
| One provider fails, another succeeds | Log error, use successful result |
| Network timeout | Return null (timeout per provider: 5s) |
| Rate limited | Log, no retry |
| Invalid LRC | Treat as plain text |

## Status Messages

Every significant lyric event dispatches via `useStatusStore.getState().addMessage()`:

| Message | Level | Source |
|---------|-------|--------|
| "Searching lyrics for {song}..." | info | Lyrics |
| "Found lyrics from {source}" | success | Lyrics |
| "No lyrics found for {song}" | info | Lyrics |
| "Lyric offset adjusted to {offset}ms" | info | Lyrics |
| "Failed to fetch lyrics: {error}" | warn | Lyrics |

## Edge Cases

1. **Song changes while fetching**: Use AbortController signal; discard stale results via React Query key comparison
2. **Instrumental tracks**: Return no lyrics (LRCLib has instrumental flag)
3. **Multiple songs with same name**: Fuse.js ranking prioritizes artist match + synced over plain
4. **Offset on seek**: Recalculate active line immediately on seek
5. **Empty LRC file**: Treat as no lyrics
6. **Unicode/LTR languages**: Pass through without transformation
7. **Very long lyrics**: ScrollArea with reasonable max-height; VirtualList if > 200 lines

## Cache Strategy

| Cache | Type | TTL | Location |
|-------|------|-----|----------|
| Embedded lyrics | SQLite | Permanent | services/db/ |
| `.lrc` file paths | SQLite | Permanent | services/db/ |
| Remote lyrics (auto) | React Query | Infinite (never stale) | IndexedDB |
| Remote lyrics (override) | React Query | Infinite | IndexedDB |
| LRU lyric results | In-memory | 10 items | Main process (Electron only) |

## Files Changed

### New files
```
src/types/lyrics-types.ts
src/services/lyrics/lrc-parser.ts
src/services/lyrics/lyrics-service.ts
src/services/lyrics/lyrics-ranking.ts
src/services/lyrics/providers/lrclib-provider.ts
src/services/lyrics/providers/netease-provider.ts
src/stores/lyrics.store.ts
src/features/lyrics/lyrics-panel.tsx
src/features/lyrics/synchronized-lyrics.tsx
src/features/lyrics/unsynchronized-lyrics.tsx
src/features/lyrics/lyric-line.tsx
src/features/lyrics/lyrics-actions.tsx
src/features/lyrics/components/lyrics-settings-form.tsx
src/features/lyrics/components/lyrics-search-modal.tsx
src/features/lyrics/components/lyrics-export-modal.tsx
```

### Modified files
```
src/types/domain-types.ts
src/stores/settings.store.ts
electron/main.ts
electron/preload.ts
src/features/player/full-screen-player.tsx
src/services/indexer/local-indexer.ts
src/types/song-dto.ts (may already have lyrics field)
```
