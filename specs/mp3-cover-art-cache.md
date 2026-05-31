# Spec: MP3 Cover Art Extraction, Caching & Retrieval

> **Status**: pending  
> **Created**: 2026-05-28  
> **Target**: `selftify` — local music cover art support

---

## Problem

Local music files (MP3, FLAC, etc.) with embedded ID3/picture tags are scanned, but cover art is explicitly **skipped** (`skipCovers: true`). No image is stored or displayed. The `imageUrl` field in `Song`/`Album`/`AlbumArtist` types is **always `null`** for local origin.

## Goal

Extract embedded cover art during the local file scan, persist it in a **browser-storage cache** (IndexedDB), and provide fast retrieval via tag-based keys. Eliminate duplicate storage via content-addressed hashing.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     local-indexer.ts (scan)                          │
│  processFile() → music-metadata (skipCovers: false)                  │
│                → picture[] → hash → IndexedDB                        │
│                → tags: [artist/X, album/X/Y, song/songId]            │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   image-cache.ts (new service)                       │
│                                                                      │
│  IndexedDB "ytmusic-images":                                         │
│  ┌─────────────┐    ┌──────────────────────────────────┐            │
│  │  images     │    │  tags                             │            │
│  │─────────────│    │──────────────────────────────────│            │
│  │ hash (PK)   │◄───│ hash (FK)                        │            │
│  │ blob        │    │ tag (string, indexed)            │            │
│  │ format      │    │  e.g. "artist/Pink Floyd"        │            │
│  │ size        │    │       "album/Pink Floyd/Wall"    │            │
│  │ created_at  │    │       "song/local_abc123"        │            │
│  └─────────────┘    └──────────────────────────────────┘            │
│                                                                      │
│  In-memory blob-URL cache: Map<hash, string>                         │
│                                                                      │
│  Public API:                                                         │
│    storeImage(blob, format, tags) → hash                             │
│    getImageUrlByTag(tag) → string | null                             │
│    getImageUrlsByTagPrefix(prefix) → string[]                        │
│    getHash(blob) → string                                            │
│    clear()                                                           │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  local-controller.ts (query)                          │
│                                                                      │
│  getImageUrl(songId):                                                │
│    1. Try tag "song/<songId>"                                        │
│    2. Fallback tag "album/<artist>/<album>"                          │
│    3. Fallback tag "artist/<artist>"                                 │
│                                                                      │
│  toSong(): imageUrl = blob URL from cache (resolved async)           │
│                                                                      │
│  New album methods:                                                  │
│    getAlbumList() → aggregate from songs table                       │
│    getAlbumDetail() → aggregate + cached image                       │
│                                                                      │
│  New artist methods:                                                 │
│    getAlbumArtistList() → aggregate from songs table                 │
│    getAlbumArtistDetail() → aggregate + all artist images            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Tag Scheme

| Tag Pattern | Purpose | Cardinality | Query Example |
|---|---|---|---|
| `artist/<artistName>` | Artist image | 1+ per artist | `getImageUrlsByTagPrefix("artist/Pink Floyd")` → all images |
| `album/<artistName>/<albumName>` | Album cover | 1+ per album | `getImageUrlByTag("album/Pink Floyd/The Wall")` → first match |
| `song/<songId>` | Track-specific image | 0-1 per song | `getImageUrlByTag("song/local_abc123")` |

**Rules**:
- All artist/album names are normalized to **lowercase** for tag storage (case-insensitive lookup)
- Multiple images per tag are allowed — retrieval returns first match by default, or all via prefix
- The same image blob (same hash) can have **multiple tags** (e.g., same cover for song + album + artist)

---

## Deduplication via Content Hashing

**Primary key**: SHA-256 hash of the raw image blob bytes.

Why SHA-256 over user-requested MD5:
- Built into all browsers/Tauri WebViews via `crypto.subtle.digest("SHA-256", data)`
- No external dependency required
- Collision-resistant (unlike MD5 which has known collisions)
- Same property: identical bytes → identical hash → stored once

A `storeImage()` call hashes the blob first. If the hash already exists in IndexedDB, **only** the new tag is added (no duplicate blob storage).

---

## Image Cache Service

### New file: `src/services/image-cache.ts`

```typescript
// ── IndexedDB Schema ──

// DB: "ytmusic-images" v1
// Object Store "images"   — keyPath: "hash"
// Object Store "tags"     — keyPath: autoIncrement
//   Index "by_hash" on hash
//   Index "by_tag"  on tag

// ── Types ──

type StoredImage = {
  hash: string;        // SHA-256 hex (PK)
  blob: Blob;           // raw image bytes
  format: string;       // MIME type (e.g., "image/jpeg", "image/png")
  size: number;         // byte length
  created_at: number;
};

type ImageTag = {
  id?: number;
  hash: string;
  tag: string;          // e.g. "artist/pink floyd"
};

// ── Public API ──

async function storeImage(blob: Blob, format: string, tags: string[]): Promise<string>
// 1. Reads blob bytes → ArrayBuffer
// 2. SHA-256 hash via crypto.subtle.digest
// 3. If hash not in "images" → store blob + format
// 4. For each tag → INSERT INTO "tags" (hash, tag) if not exists
// 5. Returns hash

async function getImageUrlByTag(tag: string): Promise<string | null>
// 1. Query "tags" index by_tag = tag, limit 1
// 2. If found → query "images" by hash
// 3. Blob → URL.createObjectURL → cache in memory Map<hash, string>
// 4. Return blob URL

async function getImageUrlsByTagPrefix(prefix: string): Promise<string[]>
// 1. Open cursor on "tags" index "by_tag"
// 2. Range: IDBKeyRange.bound(prefix, prefix + '\uffff')
// 3. Collect unique hashes
// 4. For each hash → getImageUrlByTag-like blob-URL resolution
// 5. Return array of blob URLs

async function getHash(blob: Blob): Promise<string>
// SHA-256 of blob bytes → hex string

async function clear(): Promise<void>
// Deletes all images and tags, revokes all cached blob URLs
```

### Memory cache for blob URLs

```typescript
const blobUrlCache = new Map<string, string>();
// hash → blobURL
// Prevents creating new blob URLs on every call
// On clear(): revokeObjectURL for each, then clear map
```

---

## Indexer Changes

### File: `src/api/indexer/local-indexer.ts`

#### Change 1: Enable cover extraction

**Line 211** — change `skipCovers: true` to `skipCovers: false`

```diff
- const result = await mm.parseBuffer(data, { path: filePath }, { duration: true, skipCovers: true });
+ const result = await mm.parseBuffer(data, { path: filePath }, { duration: true, skipCovers: false });
```

#### Change 2: Extract and store cover images

After the `music-metadata` parsing section (after line 230), add image extraction:

```typescript
// Extract embedded pictures
const pictures = result.common.picture || [];
const imageTags: string[] = [];

if (artistNormalized) {
  imageTags.push(`artist/${artistNormalized}`);
}
if (albumNormalized && artistNormalized) {
  imageTags.push(`album/${artistNormalized}/${albumNormalized}`);
}

const songId = fileIdFromPath(filePath);
imageTags.push(`song/${songId}`);

for (const picture of pictures) {
  const blob = new Blob([picture.data], { type: picture.format });
  await imageCache.storeImage(blob, picture.format, imageTags);
}
```

#### Change 3: Normalize artist/album names for tags

Names used in tags must be lowercase-normalized:

```typescript
const artistNormalized = meta.artist_name.toLowerCase().trim();
const albumNormalized = meta.album_name?.toLowerCase().trim() || null;
```

#### Change 4: Cleanup on re-scan

In the `start()` function (line 49-73), add `await imageCache.clear()` alongside `deleteAllSongs()`.

---

## Local Controller Changes

### File: `src/api/local/local-controller.ts`

#### Change 1: `toSong()` now resolves imageUrl

```typescript
async function toSong(row: any): Promise<Song> {
  const artistNorm = (row.artist_name || "").toLowerCase().trim();
  const albumNorm = (row.album_name || "").toLowerCase().trim();
  
  let imageUrl: string | null = null;
  
  // Priority: song-specific → album → artist
  imageUrl = await imageCache.getImageUrlByTag(`song/${row.id}`);
  if (!imageUrl && albumNorm && artistNorm) {
    imageUrl = await imageCache.getImageUrlByTag(`album/${artistNorm}/${albumNorm}`);
  }
  if (!imageUrl && artistNorm) {
    imageUrl = await imageCache.getImageUrlByTag(`artist/${artistNorm}`);
  }
  
  return { ...same, imageUrl };
}
```

#### Change 2: `getImageUrl()` implementation

```typescript
getImageUrl: async (songId: string) => {
  const row = await getSongById(songId);
  if (!row) return null;
  const artistNorm = (row.artist_name || "").toLowerCase().trim();
  const albumNorm = (row.album_name || "").toLowerCase().trim();
  
  return imageCache.getImageUrlByTag(`song/${songId}`)
    || (albumNorm && artistNorm ? imageCache.getImageUrlByTag(`album/${artistNorm}/${albumNorm}`) : null)
    || (artistNorm ? imageCache.getImageUrlByTag(`artist/${artistNorm}`) : null);
}
```

#### Change 3: Implement album list/detail from DB aggregation

```typescript
getAlbumList: async (_offset = 0, limit = 100) => {
  const rows = await getAlbumsFromSongs(); // NEW DB query
  return rows.map(row => ({
    ...toAlbum(row),
    imageUrl: ... // from imageCache.getImageUrlByTag(`album/${artistNorm}/${albumNorm}`)
  }));
}
```

#### Change 4: Implement artist list/detail from DB aggregation

```typescript
getAlbumArtistList: async (_offset = 0, limit = 100) => {
  const rows = await getArtistsFromSongs(); // NEW DB query
  return rows.map(row => ({
    ...toArtist(row),
    imageUrl: ... // from imageCache.getImageUrlByTag(`artist/${artistNorm}`)
  }));
}
```

#### Change 5: All methods using `toSong()` become async-aware

Since `toSong()` now does async IndexedDB lookups, callers that `map(toSong)` need to use `Promise.all()`:

```typescript
search: async (query, limit = 50) => {
  const results = await searchSongs(query, limit);
  return {
    songs: await Promise.all(results.map(toSong)),
    albums: [],
    albumArtists: [],
  } as SearchResults;
},
```

---

## Database Queries (New)

### File: `src/services/local-database.ts`

Add aggregation queries for album/artist views:

```typescript
export async function getAlbumsFromSongs(): Promise<{ name: string; artist_name: string }[]> {
  const db = await getDb();
  return db.select(
    `SELECT DISTINCT album_name as name, artist_name
     FROM songs
     WHERE album_name IS NOT NULL
     ORDER BY artist_name, album_name`
  );
}

export async function getArtistsFromSongs(): Promise<{ name: string }[]> {
  const db = await getDb();
  return db.select(
    `SELECT DISTINCT artist_name as name
     FROM songs
     ORDER BY artist_name`
  );
}
```

---

## Files Summary

| File | Action | Purpose |
|---|---|---|
| `src/services/image-cache.ts` | **CREATE** | IndexedDB image store + tag index + blob-URL cache |
| `src/api/indexer/local-indexer.ts` | **MODIFY** | `skipCovers: false`, extract pictures, store in cache |
| `src/api/local/local-controller.ts` | **MODIFY** | Async imageUrl resolution, implement album/artist methods |
| `src/services/local-database.ts` | **MODIFY** | Add aggregation queries for albums/artists |

---

## Dependencies

**None new.** All required APIs are built-in:

| API | Used for |
|---|---|
| `crypto.subtle.digest("SHA-256")` | Content hashing (deduplication key) |
| `indexedDB` | Persistent key-value store for images + tags |
| `URL.createObjectURL()` / `URL.revokeObjectURL()` | Convert blobs to displayable URLs |
| `music-metadata` (already a dep) | Extract `common.picture[]` from ID3/Vorbis tags |

---

## Fallback Behavior

1. **No embedded cover** → `imageUrl` remains `null` → UI shows letter avatar (existing behavior)
2. **IndexedDB unavailable** (rare: private browsing in strict mode) → graceful skip, `imageUrl = null`
3. **Hash collision** (SHA-256) → virtually impossible, no special handling needed
4. **Large images** → cap at 2 MB per image to prevent storage bloat (ID3 covers are typically < 500 KB)

---

## Performance Considerations

- **Scan speed**: Enabling `skipCovers: false` adds ~100-200ms per file (parsing + IndexedDB write). For large libraries, the async batch processing in the indexer naturally handles this.
- **Blob URL lifetime**: Blob URLs are kept in memory until `clear()` is called (on re-scan). Revocation strategy can be improved later with LRU or reference counting.
- **IndexedDB reads**: Tag-based queries use indexed lookups (no full scan). Query time < 1ms typical.
- **Deduplication savings**: For albums with 10+ tracks sharing the same embedded cover, only 1 blob is stored instead of 10.

---

## Testing Checklist

- [ ] Scan a folder of MP3s with embedded cover art → images appear in library view
- [ ] Same cover across multiple tracks in the same album → stored only once (verify via hash)
- [ ] Re-scan: images are cleared and re-extracted
- [ ] MP3 without embedded cover → fallback to artist image if available, else letter avatar
- [ ] Artist page shows all unique images for that artist (via `getImageUrlsByTagPrefix`)
- [ ] Album page shows the album cover (first image found for `album/<artist>/<album>`)
- [ ] Web build (no Tauri): IndexedDB still works, images persist across page reloads
- [ ] Mobile/Android: cover art displays correctly
- [ ] Large library scan (1000+ files): scan completes, no OOM, images display
- [ ] Files without embedded pictures: no errors, scan continues normally
