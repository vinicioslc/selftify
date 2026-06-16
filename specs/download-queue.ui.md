# Download Queue — UX/UI

## Components

### 1. DownloadButton

A reusable component placed next to songs throughout the app.

**Props:**
```typescript
type DownloadButtonProps = {
  song: Song;
  variant?: "icon" | "button";
  size?: "sm" | "default";
};
```

**States:**
- **Default**: Download icon (Lucide `download`) with tooltip "Download". `variant="button"` also shows text "Download".
- **In queue**: Clock icon with tooltip "In queue — N ahead". Disabled.
- **In progress**: Spinning loader with tooltip "Downloading...". Disabled.
- **Completed**: CheckCircle icon with tooltip "Downloaded". Disabled.
- **Already exists**: Same as Completed — CheckCircle icon with tooltip "Downloaded". The task is marked COMPLETED immediately after `enqueueSong` + `processTask` detects the file on disk, without any download pipeline. The `audioPath` is set to the existing file path.
- **Failed**: AlertCircle icon with tooltip "Failed — click to retry". On click, calls `retryTask`.
- **Hidden**: Not rendered if song has `path` (already local). Only shown for online songs.

**Visual:**
```
Default:  [⬇]           (icon, ghost variant, h-8 w-8)
Button:   [⬇ Download]  (with text, size-sm)
Queued:   [⏳]
Done:     [✅]
Failed:   [⚠️]
```

**Placement contexts:**
- Search result cards: icon variant after song name
- Library song rows: icon variant at end of row
- Album detail track list: one icon per track + "Download All" button in header
- Player bar: button variant "Download Current"

### 2. Player Bar — New Buttons

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◄◄  ►/❚❚  ►►   [──────●──────────]  3:45 ─ 4:20                   │
│                                                              [⬇] [📋 3] │
└──────────────────────────────────────────────────────────────────────┘
```

**⬇ Download Current:**
- Icon: Lucide `download`
- Tooltip: "Download current track"
- Click: enqueues `usePlayerStore.currentTrack` via `downloadStore.enqueueSong()`
- Disabled when: currentTrack is null, already in queue, or has local `path`
- Mobile: included in overflow `...` menu if screen < 480px

**📋 Queue (N):**
- Icon: Lucide `list-ordered` (or `tray`)
- Badge N: count of pending + in-progress tasks (0 = no badge)
- Tooltip: "Open download queue"
- Click: sets `downloadStore.isPanelOpen = true`, rendering the DownloadQueuePanel
- Mobile: same behavior, panel opens as full-screen sheet

**Responsive:**
- Desktop (>768px): both buttons always visible in player bar
- Tablet (480-768px): text labels hidden, icons only
- Mobile (<480px): both collapse into a `...` overflow menu

### 3. DownloadQueuePanel

A dialog/panel showing all download tasks with progress.

**Desktop:** Centered dialog, 480×600px, with backdrop overlay. Closes on `[✕]` or click outside.
**Mobile:** Full-screen sheet, slides up from bottom. Closes via `[✕]` or swipe down.

**Layout:**

```
┌──────────────────────────────────────────────┐
│  Download Queue                    [3 active] │
│                                      [✕]      │
│  [Clear Completed]                            │
│                                               │
│  ── In Progress ──                            │
│  ┌────────────────────────────────────────┐   │
│  │ ⏳ Song Name                   [✕]     │   │
│  │    Artist Name                         │   │
│  │    ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░  45%      │   │
│  │    🔍 Searching YouTube...             │   │
│  └────────────────────────────────────────┘   │
│                                               │
│  ── Queued ── (2)  [collapse]                 │
│  ┌────────────────────────────────────────┐   │
│  │ ⏳ Next Song                    [✕]    │   │
│  │    Artist Name                         │   │
│  └────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────┐   │
│  │ ⏳ Another Song                  [✕]    │   │
│  │    Artist Name                         │   │
│  └────────────────────────────────────────┘   │
│                                               │
│  ── Completed ── (5)  [collapse]              │
│  ┌────────────────────────────────────────┐   │
│  │ ✅ Done Song                           │   │
│  │    Artist Name · 2 min ago             │   │
│  └────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────┐   │
│  │ ✅ Other Song                          │   │
│  │    Artist Name · 5 min ago             │   │
│  └────────────────────────────────────────┘   │
│                                               │
│  ── Failed ── (1)  [collapse]                 │
│  ┌────────────────────────────────────────┐   │
│  │ ❌ Broken Song                 [Retry]  │   │
│  │    Artist Name                         │   │
│  │    Error: No YouTube match found       │   │
│  └────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

**Step labels per progress state:**

| Internal status | User-facing label |
|----------------|-------------------|
| searching | Searching YouTube... |
| downloading-audio | Downloading audio... |
| getting-cover | Fetching cover art... |
| processing-cover | Processing cover image... |
| embedding-cover | Embedding into MP3... |
| completed | Completed |
| completed (skip) | Already downloaded |
| failed | Error: <message> |
| cancelled | Cancelled |

When a task is enqueued but the file already exists on disk, the task shows "Already downloaded" immediately (bypassing all download steps). The DownloadButton shows a checkmark (`CheckCircle2`) with tooltip "Downloaded", identical to a completed task.

**Progress bar:**
- Color: `--primary` (blue) when active, `--destructive` (red) when failed, `--success` (green) when completed
- Determinate: percent reflects overall task progress
- Height: 6px, rounded
- Animates smoothly via CSS transition on width

**Actions per task card:**
- Active task: Cancel button → `downloadStore.cancelTask(id)`
- Pending task: Cancel button → `downloadStore.cancelTask(id)`
- Completed task: No inline action; "Clear Completed" in header
- Failed task: Retry button → `downloadStore.retryTask(id)`

**Empty state:**
```
┌──────────────────────────────────────────────┐
│                                              │
│            📥 No downloads yet                │
│       Download songs to keep them            │
│        offline on your device.               │
│                                              │
│          [Browse Library →]                   │
│                                              │
└──────────────────────────────────────────────┘
```

### 4. Sidebar — Downloads Nav Entry

New entry in the sidebar navigation, placed under "Library" section:

```
📚 Library
  🎵 Songs
  💿 Albums
  👤 Artists
  📋 Playlists

📥 Downloads          ← new entry
```

Click opens the DownloadQueuePanel (same as Queue button in player bar).
Badge shows total active tasks (pending + in-progress).

### 5. Song Context Menu (Right-Click)

When right-clicking a song in search or library results, the context menu includes:

```
▶ Play
➕ Add to Queue
📥 Download          ← new entry
📋 Add to Playlist
```

"Download" enqueues the song via `downloadStore.enqueueSong(song)`. Disabled if song already has `path`.

### User Flows

**Flow A: Download from search**
1. User searches → results appear as cards/rows
2. User clicks ⬇ on a result → song enqueued
3. Brief toast/notification: "Added to download queue"
4. Queue panel can be opened via player bar or sidebar
5. Processing begins if no other task is active

**Flow B: Download current song**
1. User is listening to a YouTube song
2. Clicks ⬇ in player bar
3. Same as Flow A step 3-5

**Flow C: Retry failed**
1. User opens queue panel → sees failed task
2. Reads error: "No YouTube match found"
3. Clicks Retry → task reset to PENDING, re-enters pipeline
4. If succeeds → moves to Completed; if fails again → stays Failed

**Flow D: Cancel and clear**
1. Active task shows Cancel → user clicks
2. Partial audio file deleted via IPC `fs:delete-file`
3. Task moves to Cancelled section
4. "Clear Completed" removes all Completed + Cancelled tasks from list

### 6. Song Info — YouTube Source Display

When a downloaded song is viewed in the Song Info panel (`SongInfoContent`), the metadata section shows the original YouTube source:

```
Title:          Bohemian Rhapsody
Artist:         Queen
Album:          A Night at the Opera
Duration:       5:55
YouTube Source: Bohemian Rhapsody (Official Video)
                by Queen Official
                🔗 https://music.youtube.com/watch?v=fJ9rUzIMcZQ
```

- Visible only when `song.youtubeVideoTitle` is present
- Shows: video title, channel name (if available), link icon
- Title and channel link to the YouTube video (opens externally)
- Icon: `ExternalLink` (Lucide) next to the YouTube title
- Placement: in the metadata `<div>`, after the MusicBrainz IDs section, styled like other `CopyableId` rows

**Data source**: The YouTube video ID, title, and channel name are embedded as ID3v2 TXXX frames (`YOUTUBE_TITLE`, `YOUTUBE_URL`, `YOUTUBE_CHANNEL`) during the download `yt:embed-artwork` step. `searchAndRank()` returns `channelName` from `video.uploader`. When the file is re-scanned by the local indexer, `local:parse-file` extracts these tags and populates `DbSong.youtube_video_id` / `youtube_video_title` / `youtube_video_channel`, which flows through the DTO to `Song.youtubeVideoId` / `youtubeVideoTitle` / `youtubeChannelName`.

### Color/Loading Conventions

- Active progress bar: `bg-primary`
- Completed: `text-green-500` / `bg-green-500`
- Failed: `text-red-500` / `bg-red-500` with alert icon
- Cancelled: `text-muted-foreground` with slash-through icon
- Step label: `text-xs text-muted-foreground`
- Task card: `bg-card border border-border rounded-lg p-3`
- Section header: `text-xs font-semibold text-muted-foreground uppercase tracking-wider`
