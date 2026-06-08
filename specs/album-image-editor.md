# Spec: Album & Artist Image Editor

> **Status**: implemented
> **Created**: 2026-06-05
> **Target**: selftify — allow users to manage custom cover images per album and artist

---

## Problem

The app needed a unified way to manage images for both albums and artists, with a consistent flow: check local filesystem first, then query online providers, and auto-save results.

---

## Providers

Only two artwork providers are used:
- **iTunes** — searches `itunes.apple.com/search` by artist + album name
- **Deezer** — searches `api.deezer.com/search/album` by artist + album name

All other providers (CoverArtArchive, MusicBrainz RG, Spotify, Discogs, Fanart.tv, Embedded) were removed.

---

## Image Loading Flow

Both album and artist image managers follow the same priority:

```
1. IndexedDB / Electron store       → cached from previous session
2. .img folder on filesystem         → {artist}/.img/ or {artist}/{album}/.img/
3. Online providers (iTunes, Deezer) → only if not found locally
```

### Step 1 — Check store
Fast path: query IndexedDB (web) or Electron IPC store (Electron). If found, show immediately.

### Step 2 — Check .img folder
If not in store, scan the filesystem directory for `.img/` files. Pick the first image found (sorted alphabetically). Load into store for future fast access.

### Step 3 — Online providers
Only reached if nothing was found locally. User clicks a provider to search. Results appear as thumbnails. Selecting one **auto-saves** to store + filesystem immediately.

---

## Auto-Save Behavior

Any image selection — whether from providers, Wikipedia, or custom URL — immediately:

1. **Resizes** the image (albums: 1024×1024 max, square crop, JPEG 92%)
2. **Stores** to IndexedDB (web) or Electron IPC store (Electron)
3. **Writes** to filesystem at `{artist}/.img/{mbzId}.{source}.jpg` (artists) or `{artist}/{album}/.img/[{mbzId}.]{source}.jpg` (albums)

Filesystem writes resolve the target root from the album/artist `originId`, not from whichever origin is currently selected in the UI. After `writeFile`, Electron callers verify the file with `getFileStats()` so a false-positive IPC success is logged as a failed persistence attempt.

No separate "Save" button — selection = save.

### Filesystem path patterns

| Type | Path |
|---|---|
| **Artist** | `{root}/{Artist}/.img/{mbzId}.{sourceType}.jpg` |
| **Album** | `{root}/{Artist}/{Album}/.img/[{mbzId}.]{sourceType}.jpg` |

Where `{mbzId}.` is optional — only added when a MusicBrainz Release ID is known.

### Image resize rules (albums only)

- Crop to 1:1 aspect ratio (center)
- Downscale to max 1024px (never upscale)
- Output as JPEG quality 92%

---

## Components

### AlbumImageManager (`src/features/album/album-image-manager.tsx`)

| Section | Behavior |
|---|---|
| **Preview** | Shows current image (from store or .img folder) |
| **Providers** | iTunes + Deezer. Search → select → auto-save |
| **Wikipedia** | Search by album + artist name → auto-save |
| **Custom URL** | Paste image URL → auto-save |
| **Remove** | Deletes all variants from .img folder + clears store |

### ArtistImageManager (`src/features/artist/artist-image-manager.tsx`)

| Section | Behavior |
|---|---|
| **Preview** | Shows current image (from store or .img folder, album covers filtered out) |
| **Wikipedia** | Search by artist name → auto-save |
| **Custom URL** | Paste image URL → auto-save |
| **Remove** | Deletes all variants from .img folder + clears store |

---

## Files Changed

| File | Action |
|---|---|
| `src/services/artwork/artwork-resolver.ts` | Rewritten — only iTunes + Deezer |
| `src/features/album/album-image-manager.tsx` | Rewritten — auto-save, .img folder check |
| `src/features/artist/artist-image-manager.tsx` | Rewritten — auto-save, .img folder check |
| `src/features/song-info/song-info-dialog.tsx` | Updated PROVIDER_LABELS |
| `src/services/image-preloader.ts` | Created (scans .img folders after scan) |
| `src/hooks/use-local-scan.ts` | Calls preloader on scan done / startup |
| `src/services/electron-image-store.ts` | Fixed `electronRecordToBlobUrl` |
| `src/services/artist-image.ts` | Uses `findImages` + filter + Electron store |
| `src/hooks/use-artist-image.ts` | Uses `findImages` + filter + Electron store |
| `src/api/indexer/local-indexer.ts` | Stability fixes (timeout, try/catch, batch) |

---

## Edge Cases

| State | Behavior |
|---|---|
| **No .img folder** | Silently ignored, falls through to providers |
| **Electron store missing** | `electronRecordToBlobUrl` fetches data via hash |
| **Provider returns no results** | Shows empty state, user can try Wikipedia |
| **Album covers in artist search** | Filtered by `!r.albumName` |
| **Filesystem save fails** | Non-fatal — store save always works |
