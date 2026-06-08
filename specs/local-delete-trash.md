# Local File Delete → Trash

## Problem

Currently, there is no way for the user to delete local songs from the library. The only
way to remove a song is to delete it at the filesystem level and rescan. Users need a
right-click "Delete" option that moves the file to a `.trash` folder within the library
root, rather than permanently deleting it.

## Solution

Add a **right-click context menu** with a "Delete" option for local songs in both the
Local library page and the Search page. The delete action:

1. Moves the file to `{libraryRoot}/.trash/` via `PlatformService.renameFile()`
2. Removes the database entry via `deleteSong()`
3. Excludes `.trash` folder from all scans so trashed files never reappear

### Non-goals

- No confirmation dialog (single-click delete with undo via manual .trash recovery)
- No permanent deletion (files are always moved to .trash, never `deleteFile`)
- No "Empty Trash" UI (user must manually clean the `.trash` folder)

---

## Files Changed

| File | Change |
|------|--------|
| `src/services/move-to-trash.ts` | **Create** — `moveSongToTrash()` utility |
| `src/services/platform/types.ts` | Modify — add `renameFile()` to `PlatformService` interface |
| `src/services/platform/electron.ts` | Modify — implement `renameFile()` |
| `src/services/platform/web.ts` | Modify — implement `renameFile()` |
| `src/services/platform/factory.ts` | Modify — export `getPlatformService()` |
| `src/features/local/local-page.tsx` | Modify — add right-click context menu with Delete |
| `src/features/search/search-page.tsx` | Modify — add Delete option to existing context menu |
| `src/api/indexer/local-indexer.ts` | Modify — skip `.trash` in all 4 directory-walking loops |
| `specs/local-delete-trash.md` | **Create** — this spec |

---

## Behavior

### Context Menu

Both `local-page.tsx` and `search-page.tsx` provide a right-click context menu for songs:

| Option | Icon | Action |
|--------|------|--------|
| Play | ▶ | `setQueue([song], { type: "now" })` |
| Play Next | ⏭ | `addToQueue([song], { type: "next" })` |
| Add to Playlist | 📋 | Opens `AddToPlaylistDialog` |
| — | separator | `DropdownMenuSeparator` |
| Delete | `Trash2` icon, `text-destructive` | Calls `moveSongToTrash()` |

**Delete is only shown** when:
- `song.path` is truthy (file exists on disk)
- `song.originType === OriginType.LOCAL`

### Delete Flow

```
User right-clicks song → "Delete" clicked
  → moveSongToTrash(filePath, origin)
    → PlatformService.fileExists(libraryRoot/.trash) → create if missing
    → PlatformService.renameFile(filePath, .trash/filename)
    → If name conflict: append _timestamp suffix
    → Delete database entry via deleteSong(fileIdFromPath(filePath))
    → Remove song from local UI state (setSongs(prev.filter(...)))
    → Status message: "Moved to trash: filename"
```

### moveSongToTrash() API

```ts
// src/services/move-to-trash.ts

export async function moveSongToTrash(
  filePath: string,
  origin: Origin,
): Promise<boolean>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `filePath` | `string` | Absolute path to the song file |
| `origin` | `Origin` | Local origin (provides `folderPath` as library root) |

Returns `true` if the file was moved and database entry deleted successfully.

Error paths:
- `origin.folderPath` is missing → `false`, status "warn"
- `.trash` directory creation fails → `false`, status "danger"
- `PlatformService.renameFile()` fails → `false`, status "danger"
- Database deletion fails → `true` (file already moved), status "warn"

### Trash path resolution

```
root = origin.folderPath  // e.g. /home/user/Music
trashDir = root + "/.trash"
finalPath = trashDir + "/" + filename  // e.g. /home/user/Music/.trash/song.mp3
```

On name conflict (file already exists in `.trash`):
```
filename = "song.mp3"
base = "song"
ext = ".mp3"
finalPath = .trash/song_1740000000000.mp3
```

### .trash exclusion from scans

The `.trash` directory is excluded in all 4 directory-passing loops in `local-indexer.ts`:

| Loop | Line | Exclusion |
|------|------|-----------|
| BFS initial (discover root directories) | `if (e.name !== ".trash")` | Skip adding `.trash` to BFS queue |
| `discoverAndEnqueue` | `if (e.name !== ".img" && e.name !== ".trash")` | Skip both `.img` and `.trash` |
| `processDirectory` | `if (entry.name !== ".trash")` | Skip `.trash` when iterating files |
| Watcher BFS (auto-scan new dirs) | `if (e.name !== ".trash")` | Same as BFS initial |

---

## Platform Service Changes

### PlatformService interface — added method

```ts
renameFile(oldPath: string, newPath: string): Promise<boolean>;
```

### Electron implementation

```ts
// src/services/platform/electron.ts
async renameFile(oldPath: string, newPath: string): Promise<boolean> {
  try {
    await window.electronApi.fs.rename(oldPath, newPath);
    return true;
  } catch (err) {
    console.error("[electron] renameFile error:", err);
    return false;
  }
}
```

### Web implementation

```ts
// src/services/platform/web.ts
async renameFile(oldPath: string, newPath: string): Promise<boolean> {
  // Web has no filesystem rename; always fails
  return false;
}
```
