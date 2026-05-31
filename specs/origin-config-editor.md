# Spec: Origin Config Editor & Search Sources

> **Status**: implemented
> **Created**: 2026-05-30
> **Target**: `selftify` — manage saved origins (configs) and search scoping

---

## Problem

Users had no way to edit existing saved origins (YouTube Music cookies, MusicBrainz token, folder paths, etc.) after initial setup. The Settings page only allowed deleting or selecting an origin. Additionally, there was no way to scope search to a specific origin from the sidebar, and the MusicBrainz search feature existed only as UI scaffolding with no actual implementation.

---

## Solution

Three interrelated features:

1. **Origin edit dialog** — edit name, cookies, URL, MusicBrainz settings on any saved origin
2. **Search sub-levels in sidebar** — expandable "Search" section listing all origins + MusicBrainz as scoped search targets
3. **MusicBrainz search** — real API client against `musicbrainz.org/ws/2/` for artist/album/recording lookup, activated by `musicBrainzSearchMode`

---

## Architecture

### 1. Origin Edit Dialog

```
SettingsPage (Servers tab)
  └── Origin list (origins.map)
       ├── Select button  → setCurrentOrigin(o)
       ├── Edit (pencil)  → opens OriginEditDialog
       │    └── OriginEditDialog
       │         ├── Name input
       │         ├── Credential input (cookies, shown only for YOUTUBE_MUSIC)
       │         ├── URL input
       │         ├── Use MusicBrainz switch
       │         ├── MusicBrainz Token input
       │         ├── Search Mode select (mixed / musicbrainz / youtube)
       │         └── Cancel / Save buttons
       └── Delete button  → removeOrigin(o.id)
```

**Flow:** Edit button sets `editingOrigin` state → `OriginEditDialog` opens pre-filled → Save calls `updateOrigin(id, updates)` from auth store → dialog closes.

### 2. Sidebar Search Sub-levels

```
Sidebar
  ├── Home
  ├── Search (expandable/collapsible with chevron)
  │    ├── <origin.name>      — sets currentOrigin + navigates to search
  │    ├── <origin.name>      — (each saved origin)
  │    └── MusicBrainz        — sets origin with useMusicBrainz=true + navigates to search
  ├── Library
  └── Settings
```

**Behavior:**
- `searchExpanded` state (default `true`) toggles visibility of origin sub-items
- Each origin sub-item shows a type-appropriate icon (YouTube → `Youtube`, Local → `FolderOpen`, others → `Music2`)
- Hover tooltip (`title` attribute) shows `"<type> • <url>"` for each origin
- Clicking an origin calls `setCurrentOrigin(origin)` then `onNavigate("search")`
- Clicking MusicBrainz finds the first origin with `useMusicBrainz: true` (or falls back to `currentOrigin`), sets it, and navigates to search

### 3. MusicBrainz Search

```
SearchPage
  └── getSearchController()
       ├── if useMusicBrainz && musicBrainzSearchMode === "musicbrainz"
       │    └── createMusicBrainzController()  → searches musicbrainz.org
       └── else
            └── getController()  → normal origin controller (YouTube/Local/etc.)
```

**MusicBrainz API client** (`src/api/musicbrainz/musicbrainz-api.ts`):

| Endpoint | Entity | Returns |
|---|---|---|
| `GET /ws/2/artist/?query=<q>&limit=N&fmt=json` | `artists` | `MBArtist[]` (id, name, disambiguation, type, country, tags) |
| `GET /ws/2/release/?query=<q>&limit=N&fmt=json` | `releases` | `MBRelease[]` (id, title, date, country, artist-credit, media) |
| `GET /ws/2/recording/?query=<q>&limit=N&fmt=json` | `recordings` | `MBRecording[]` (id, title, length, artist-credit, releases) |

**Rate limiting:** 1 req/s without authentication, up to 50 req/s with a MusicBrainz token. The `User-Agent` header includes the token from the origin's `musicBrainzToken` field.

**MusicBrainz controller** (`src/api/musicbrainz/musicbrainz-controller.ts`):
- Implements `ServerController` interface
- `search()` calls `searchMusicBrainz()` which runs all 3 endpoint searches in parallel
- Maps results to domain types: `MBArtist` → `AlbumArtist`, `MBRelease` → `Album`, `MBRecording` → `Song`
- Non-search methods (`getAlbumDetail`, `getStreamUrl`, etc.) return `null`/`[]` since MusicBrainz is metadata-only
- Errors are caught and logged, returning empty results

---

## Store Changes

### `src/stores/auth.store.ts` — no changes needed

The `updateOrigin()` method already existed and is used by the edit dialog.

### `src/api/controller.ts` — ApiContext extended

```typescript
export type ApiContext = {
  originId: string;
  originType: OriginType;
  baseUrl?: string;
  credential?: string;
  musicBrainzToken?: string;       // new
  useMusicBrainz?: boolean;        // new
  musicBrainzSearchMode?: "mixed" | "musicbrainz" | "youtube";  // new
};
```

New function:

```typescript
export async function getSearchController(): Promise<ServerController> {
  const ctx = getContext();
  if (ctx.useMusicBrainz && ctx.musicBrainzSearchMode === "musicbrainz") {
    return (await import("./musicbrainz/musicbrainz-controller")).createMusicBrainzController(ctx);
  }
  return getController();
}
```

---

## Files Changed

| File | Action | Purpose |
|---|---|---|
| `src/features/settings/origin-edit-dialog.tsx` | **CREATE** | Dialog for editing origin name, cookies, URL, MusicBrainz settings |
| `src/features/settings/settings-page.tsx` | MODIFY | Add edit button (+ `Pencil` icon) and `OriginEditDialog` integration |
| `src/api/musicbrainz/musicbrainz-api.ts` | **CREATE** | MusicBrainz API client (artist/release/recording search) |
| `src/api/musicbrainz/musicbrainz-controller.ts` | **CREATE** | Controller wrapping MusicBrainz API in `ServerController` interface |
| `src/api/controller.ts` | MODIFY | Add `musicBrainz*` fields to `ApiContext`, add `getSearchController()` |
| `src/features/sidebar/sidebar.tsx` | MODIFY | Search expandable with origin sub-items + MusicBrainz item |
| `src/features/search/search-page.tsx` | MODIFY | Use `getSearchController()` instead of `getController()`, add error state |

---

## Edge Cases & States

| State | Behavior |
|---|---|
| **No origins saved** | Search sub-levels show no origin items; MusicBrainz button navigates with currentOrigin if set |
| **No origin with MusicBrainz enabled** | Sidebar MusicBrainz click falls back to `currentOrigin` |
| **MusicBrainz API unavailable** | Error caught in controller, empty results returned; SearchPage shows "No results found" |
| **MusicBrainz API error** | `searchError` state set with error message from caught exception |
| **Origin with musicBrainzSearchMode="youtube"** | `getSearchController()` falls through to `getController()` — normal YouTube search |
| **Origin with musicBrainzSearchMode="mixed"** | Currently uses `getController()` only (mixed mode not yet implemented) |
| **Edit dialog — cancel** | State reset to origin's current values, no changes persisted |
| **Edit dialog — empty name** | No validation; empty name saved as-is |
| **Sidebar collapsed** | Only icons shown; sub-levels hidden until expanded |
