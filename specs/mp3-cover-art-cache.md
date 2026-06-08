# Spec: MP3 Cover Art Extraction, Caching & Retrieval

> **Status**: implemented  
> **Created**: 2026-05-28  
> **Last updated**: 2026-06-07  
> **Target**: `selftify` — local music cover art support

---

## Problem

Local music files (MP3, FLAC, etc.) with embedded ID3/picture tags are scanned, but cover art was initially **skipped** (`skipCovers: true`). No image was stored or displayed. The `imageUrl` field in `Song`/`Album`/`AlbumArtist` types was **always `null`** for local origin.

## Goal

Extract embedded cover art during the local file scan, persist it in a **deduplicated IndexedDB storage** (`selftify-images-v2`), enrich with MusicBrainz IDs from ID3 tags for reliable matching, and provide fast retrieval via field-based queries. Avoid network requests for covers that exist locally.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                   local-indexer.ts (scan phase)                      │
│                                                                      │
│ processFile() → music-metadata (skipCovers: false)                   │
│   → embedded picture → hash → ImageRecord (with MBZ IDs)             │
│   → storeImage() in IndexedDB                                        │
│                                                                      │
│ processDir() → .img/ folder found                                    │
│   → reads image file → storeImage() (without MBZ IDs yet)            │
│                                                                      │
│ image-preloader.ts (post-scan)                                       │
│   → preloadAlbumImage() → queries songs in same album                │
│   → updateImageMeta() attaches MBZ IDs to .img/ ImageRecord          │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   image-store.ts (storage layer)                      │
│                                                                      │
│  IndexedDB "selftify-images-v2" (v3):                                │
│  ┌──────────────────────────────┐                                    │
│  │  images (object store)       │  ← single store                    │
│  │  ─────────────────────────── │                                    │
│  │  md5 (PK — SHA-256 hex)     │                                    │
│  │  blob (ArrayBuffer)          │                                    │
│  │  format (MIME type)          │                                    │
│  │  size                        │                                    │
│  │  width? / height?            │                                    │
│  │  createdAt                   │                                    │
│  │  artistName? (indexed)       │                                    │
│  │  albumName? (indexed)        │                                    │
│  │  mbzArtistId? (indexed)      │                                    │
│  │  mbzReleaseGroupId? (indexed)│                                    │
│  │  mbzReleaseId?               │                                    │
│  │  sourceUrl? (indexed)        │                                    │
│  └──────────────────────────────┘                                    │
│                                                                      │
│  Public API:                                                         │
│    storeImage(record) → void         (skips if md5 exists)           │
│    updateImageMeta(md5, meta) → void (enrich existing record)        │
│    getImageByMd5(hash) → ImageRecord | null                          │
│    getImageByArtist(name) → ImageRecord | null                       │
│    getImageByAlbum(name) → ImageRecord | null                        │
│    getImageBySourceUrl(url) → ImageRecord | null                     │
│    findImages(query) → ImageRecord[]    (full cursor scan)           │
│    recordToBlobUrl(record) → blob: URL                               │
│    clearImageStore() → void                                           │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 cover-resolver.ts (CENTRALIZED SERVICE)               │
│                                                                      │
│  resolveCover(CoverInput):                                           │
│    1. loadFromAlbumDotImg()         ← filesystem .img/ folder       │
│       → caches to IndexedDB for next time                            │
│    2. findImages() with MBZ→name   ← IndexedDB (embedded tags)      │
│    3. findCoverFromDeezer()        ← remote API                     │
│       → caches to IndexedDB for next time                            │
│    4. findCoverFromItunes()        ← remote API                     │
│       → caches to IndexedDB for next time                            │
│    5. return { source: "none" }    ← letter avatar fallback         │
│                                                                      │
│  Usado por: local-controller.ts, use-cover.ts (React hook)           │
└──────────────────────────────────────────────────────────────────────┘
                               │
                  ┌────────────┴────────────┐
                  ▼                         ▼
┌────────────────────────────┐  ┌─────────────────────────────────────┐
│ local-controller.ts        │  │ use-cover.ts (React hook)           │
│ (song rows, album lists)   │  │ (album pages, artist pages)         │
│ → resolveImageUrl()        │  │ → resolveCover() via hook           │
│   delegates to cover-resolver│ │   + coverEventBus subscription     │
└────────────────────────────┘  └─────────────────────────────────────┘
```

---

## Storage Schema

### `ImageRecord` — the single unit

```typescript
type ImageRecord = {
  md5: string;                    // SHA-256 hex (PK)
  blob: ArrayBuffer;              // raw image bytes
  format: string;                 // MIME type (image/jpeg, image/png, etc.)
  size: number;                   // byte length
  width?: number;                 // optional dimensions
  height?: number;
  createdAt: number;              // timestamp
  artistName?: string;            // normalized (lowercase, trimmed)
  albumName?: string;             // normalized
  mbzArtistId?: string;           // MusicBrainz artist ID
  mbzReleaseGroupId?: string;     // MusicBrainz release-group ID (identifies album)
  mbzReleaseId?: string;          // MusicBrainz release ID (specific edition)
  sourceUrl?: string;             // original file path or URL
};
```

### IndexedDB structure

- **Database**: `selftify-images-v2` (version 3)
- **Object store**: `images` keyed by `md5`
- **Indexes**:
  | Index name | Field | Purpose |
  |---|---|---|
  | `by_artist` | `artistName` | Lookup by normalized artist name |
  | `by_album` | `albumName` | Lookup by normalized album name |
  | `by_mbz` | `mbzArtistId` | Lookup by MusicBrainz artist ID |
  | `by_rg` | `mbzReleaseGroupId` | Lookup by release-group ID |
  | `by_url` | `sourceUrl` | Lookup by original path |

### Deduplication

SHA-256 hash of the raw image bytes. `storeImage()` checks `md5` first — if a record with the same hash exists, the write is skipped entirely (no duplicate blobs). `updateImageMeta()` can later enrich an existing record without duplicating the blob.

---

## Image Ingestion

### Source A: Embedded MP3/FLAAC cover art

During `processFile()` in `local-indexer.ts`:

```typescript
// music-metadata extracts common.picture[]
if (parsed.picture && parsed.picture.data.length > 0) {
  const buf = new Uint8Array(parsed.picture.data).buffer;
  const hash = await md5Hash(buf);
  const artistNorm = parsed.artist?.toLowerCase().trim();
  const albumNorm = parsed.album?.toLowerCase().trim();

  const record = {
    md5: hash, blob: buf,
    format: parsed.picture.format || "image/jpeg",
    size: buf.byteLength, createdAt: Date.now(),
    sourceUrl: `local://${filePath}`,
    artistName: artistNorm || undefined,
    albumName: albumNorm || undefined,
    mbzArtistId: meta.mbz_artist_id || undefined,         // ← from ID3 tags
    mbzReleaseGroupId: meta.mbz_release_group_id || undefined,  // ← from ID3 tags
  };
  await storeImage(record); // or electronStoreImage() on Electron
}
```

**MBZ ID provenance**: extracted from the same song's ID3 tags (`TXXX:MusicBrainz Artist Id`, `TXXX:MusicBrainz Release Group Id`, etc.). Available at scan time because the song is being parsed right then.

### Source B: `.img/` folder on filesystem

During `processDir()` in `local-indexer.ts`:

```typescript
// Walks directory tree, finds .img/ subdirectories
// Derives artist/album from folder path structure
const artistName = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : null;
const albumName = pathParts.length >= 1 ? pathParts[pathParts.length - 1] : null;

const record = {
  md5: hash, blob: imgData.buffer as ArrayBuffer,
  format: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg",
  size: imgData.length, createdAt: Date.now(),
  sourceUrl: `local://${relPath}/.img/${imgEntry.name}`,
  artistName: artistName?.toLowerCase().trim(),
  albumName: albumName?.toLowerCase().trim(),
  // mbzArtistId/mbzReleaseGroupId ← NOT available here
  // (enriched post-scan by preloader)
};
await storeImage(record);
```

**MBZ ID enrichment**: after the scan completes, `image-preloader.ts:preloadAlbumImage()` runs:

1. Queries `getSongsByAlbum(artist, album)` from the Dexie database (all songs are now indexed with ID3 tag metadata)
2. Reads `mbz_artist_id`, `mbz_release_group_id`, `mbz_album_id` from the first matching song
3. Calls `updateImageMeta()` / `electronUpdateImageMeta()` to attach the MBZ IDs to the existing `ImageRecord`

This guarantees that even `.img/` folder images end up with the correct MBZ IDs without any network request.

### Source C: Online providers (CoverArtArchive, iTunes, Deezer)

Only used as last resort when no local image exists. Resolved via `use-cover.ts` hook or `image-fetch.ts`. Results are saved back to `image-store.ts` for future local access.

---

## Query Priority

There is a single centralized service: [`cover-resolver.ts`](../src/services/cover-resolver.ts).

### `resolveCover()` — unified entry point

All cover lookups — song rows, album pages, artist pages — go through this function:

```typescript
// Called by:
//   - local-controller.ts: resolveImageUrl() → delegates here
//   - use-cover.ts hook:           resolveCover() directly
//
// Priority:
//   1. .img/ folder on filesystem (loadFromAlbumDotImg)
//   2. IndexedDB (findImages with MBZ→name cascade)
//   3. Deezer remote API (findCoverFromDeezer)
//   4. iTunes remote API (findCoverFromItunes)
//   5. return { source: "none", blobUrl: null }

export async function resolveCover(input: CoverInput): Promise<CoverResult> {
  // Step 1: .img/ folder (filesystem — always current)
  const dotImgUrl = await loadFromAlbumDotImg(artist, album);
  if (dotImgUrl) { cacheToStore(dotImgUrl); return dotImgUrl; }

  // Step 2: IndexedDB (embedded tags from scan)
  //   queries in order: mbzArtistId+mbzReleaseGroupId,
  //                     mbzArtistId+mbzReleaseId,
  //                     artistName+albumName,
  //                     artistName,
  //                     mbzArtistId
  for (const q of queries) {
    const url = await findFromStore(q);
    if (url) return url;
  }

  // Step 3: Deezer (remote, with caching)
  const deezerUrl = await findCoverFromDeezer(artist, album);
  if (deezerUrl) { cacheToStore(deezerUrl); return deezerUrl; }

  // Step 4: iTunes (remote, with caching)
  const itunesUrl = await findCoverFromItunes(artist, album);
  if (itunesUrl) { cacheToStore(itunesUrl); return itunesUrl; }

  return { source: "none", blobUrl: null };
}
```

Remote results (Deezer, iTunes) are cached into IndexedDB via `cacheToStore()` so subsequent lookups hit step 2 directly.}
return null;
```

### `use-cover()` hook (album pages)

The `use-cover.ts` hook on album pages delegates to `resolveCover()` from the centralized `cover-resolver.ts` service. It adds:
- In-memory `blobCache` Map for zero-latency re-renders
- `coverEventBus` subscription so the hook re-resolves when a new image is stored for the same artist+album

---

## Domain Type Changes

### `Song` type ([`domain-types.ts`](../src/types/domain-types.ts))

Two new fields carry MusicBrainz IDs from the scan:

```typescript
mbzReleaseGroupId?: string;
mbzAlbumId?: string;
```

### `dto.ts` — `dbSongToSong()`

Maps the existing `DbSong` columns to the new domain fields:

```typescript
mbzReleaseGroupId: row.mbz_release_group_id || undefined,
mbzAlbumId: row.mbz_album_id || undefined,
```

These columns were already present in `DbSong` and the schema (Dexie version 4+) — they just were not exposed through the domain type.

---

## Electron-Specific Handling

### `electron-image-store.ts`

On Electron, images are stored via IPC to the main process (`window.electronApi.imageCache`). The main process stores them in a native cache. The Electron wrapper:
- Checks for `electronApi.imageCache`; if absent, falls back to IndexedDB (`image-store.ts`)
- On `find()` calls, returns metadata-only records with `blob: new ArrayBuffer(0)`
- Full blob data is fetched via `electronGetImageByMd5(hash)`
- `electronRecordToBlobUrl()` handles the zero-byte check and re-fetches if needed
- `electronUpdateImageMeta()` re-stores the record with updated metadata via `api.store()`

### `local-controller.ts` — Electron bridge

The `recordToBlobUrlSafe()` helper detects Electron's zero-byte blobs and fetches the full blob before creating a `URL.createObjectURL()`.

---

## Source of MBZ IDs

| Image source | MBZ IDs come from | When |
|---|---|---|
| **Embedded MP3 cover** | Same song's ID3 tags | At scan time (in `processFile()`) |
| **`.img/` folder** | Songs in the same album folder | Post-scan enrichment (`preloadAlbumImage()`) |
| **Online provider** | MusicBrainz release ID from search | At query time |

All local image resolution is **zero-network**: MBZ IDs come from ID3 metadata already in the files.

---

## Files Summary

| File | Action | Purpose |
|---|---|---|
| `src/services/image-store.ts` | **CREATE** | IndexedDB `selftify-images-v2`, `ImageRecord`, `findImages()` cursor scan |
| `src/services/electron-image-store.ts` | **CREATE** | Electron IPC wrapper; falls back to `image-store.ts` |
| `src/services/image-preloader.ts` | **CREATE** | Post-scan `.img/` folder scanning + MBZ ID enrichment |
| `src/services/cover-event-bus.ts` | **CREATE** | Pub/sub for `storeImage` → `useCover` re-resolution |
| `src/services/dot-img-loader.ts` | **CREATE** | On-demand filesystem `.img/` reading |
| `src/services/cover-resolver.ts` | **CREATE** | **Centralized** `resolveCover()` — unifies all cover resolution: `.img/` → IndexedDB → Deezer → iTunes |
| `src/api/indexer/local-indexer.ts` | **MODIFY** | `skipCovers: false`, store embedded covers with MBZ IDs, `.img/` dir processing |
| `src/api/local/local-controller.ts` | **MODIFY** | `resolveImageUrl()` delegates to `resolveCover()` |
| `src/hooks/use-cover.ts` | **MODIFY** | `resolveFromStore()` replaced by `resolveCover()` from centralized service |
| `src/types/domain-types.ts` | **MODIFY** | `Song` gains `mbzReleaseGroupId`, `mbzAlbumId` |
| `src/services/dto.ts` | **MODIFY** | Maps `mbz_release_group_id`, `mbz_album_id` to domain |

---

## Dependencies

**None new.** All required APIs are built-in:

| API | Used for |
|---|---|
| `crypto.subtle.digest("SHA-256")` | Content hashing (deduplication key) |
| `indexedDB` | Persistent key-value store for images |
| `URL.createObjectURL()` / `URL.revokeObjectURL()` | Convert blobs to displayable URLs |
| `music-metadata` (already a dep) | Extract `common.picture[]` from ID3/Vorbis tags |
| `window.electronApi.imageCache` | Electron main-process image store |

---

## Fallback Behavior

1. **No embedded cover + no `.img/` folder** → `imageUrl` remains `null` → UI shows letter avatar (existing behavior)
2. **IndexedDB unavailable** (private browsing) → graceful skip, `imageUrl = null`
3. **Hash collision** (SHA-256) → virtually impossible, no special handling needed
4. **Electron store missing** → `electronGetImageByMd5` re-fetches via IPC

---

## Performance Considerations

- **Scan speed**: Enabling `skipCovers: false` adds ~100-200ms per file (parsing + IndexedDB write). Batch processing mitigates this.
- **Blob URL lifetime**: Blob URLs are kept in memory until `clearImageStore()` is called on re-scan.
- **IndexedDB reads**: `findImages()` does a full cursor scan with JS filtering. For libraries with < 1000 images, this is < 10ms. For larger libraries, an index-only compound query should be considered.
- **Deduplication savings**: Albums with 10+ tracks sharing the same embedded cover store only 1 blob instead of 10.
- **`useCover` in-memory cache**: `blobCache` Map keeps resolved blob URLs for the session, avoiding repeated IndexedDB reads.

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
