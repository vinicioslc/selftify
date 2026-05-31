# Spec: Selftify TopBar with Text Status Messages

> **Status**: proposed  
> **Created**: 2026-05-30  
> **Target**: `selftify` — custom app topbar, window chrome replacement, global status messages  
> **Audience**: Developers, designers, product validation

---

## Problem

Selftify needs a modern top application bar similar to VS Code's custom title bar. The current desktop window relies on system chrome, while application feedback is scattered across individual views or unavailable globally.

The app needs one persistent, lightweight place to display operational messages such as:

- Fetching artist metadata
- Loading album cover art
- Querying MusicBrainz data
- Scanning local music files
- Buffering or reconnecting playback
- Warning about retry attempts or partial failures
- Reporting dangerous errors that need attention

This feedback must be available from any part of the application without forcing each feature to implement its own notification UI.

---

## Goals

1. Replace the system title bar with a custom Selftify TopBar in Electron.
2. Keep the TopBar visible at the top of the app at all times.
3. Show only the latest status message as concise text in the TopBar.
4. Let users click the status text to open previous messages.
5. Support message levels: `info`, `success`, `warn`, and `danger`.
6. Use a distinct color for each message level.
7. Allow any part of the application to publish status messages through a shared API.
8. Keep the design compact, text-first, and appropriate for a music player rather than a marketing surface.

---

## Non-Goals

1. This is not a toast notification system with floating popups.
2. Messages do not need to persist after app restart.
3. The first implementation does not need automatic dismissal.
4. The first implementation does not need sound alerts.
5. The first implementation does not need notification grouping or duplicate collapsing.

---

## Layout

The application layout gains a persistent TopBar row above the main content and player bar.

```txt
┌────────────────────────────────────────────────────────────┐
│ Selftify TopBar                                             │
├──────────────────────┬─────────────────────────────────────┤
│ Sidebar              │ NavBar                              │
│                      ├─────────────────────────────────────┤
│                      │ Main content                         │
├──────────────────────┴─────────────────────────────────────┤
│ PlayerBar                                                   │
└────────────────────────────────────────────────────────────┘
```

The TopBar should be approximately `38px` tall. It should not push the PlayerBar off screen or introduce document scrolling. The existing layout remains a full-height grid.

---

## TopBar Structure

The TopBar has three horizontal zones.

| Zone | Content | Behavior |
| --- | --- | --- |
| Left | Selftify identity | Displays the app name and a compact brand mark or icon |
| Center | Latest status text | Shows the newest message, truncated when necessary, clickable for history |
| Right | Window controls | Electron-only minimize, maximize/restore, close buttons |

```txt
┌────────────────────────────────────────────────────────────┐
│  Selftify       ● Fetching album art from MusicBrainz  ─ □ × │
└────────────────────────────────────────────────────────────┘
```

The TopBar should visually feel like app chrome: compact, calm, and utility-focused. It should not look like a card or banner.

---

## Window Chrome Behavior

On Electron desktop builds, the system title bar is replaced by the app TopBar.

### Electron Window

The Electron `BrowserWindow` should use frameless window chrome:

```ts
frame: false
```

The TopBar becomes the draggable window region.

### Drag Region

Most of the TopBar should allow dragging the window.

Interactive elements must opt out of dragging.

| Element | Drag behavior |
| --- | --- |
| Empty TopBar space | Draggable |
| App identity area | Draggable |
| Status text trigger | Not draggable, clickable |
| History popover | Not draggable |
| Window controls | Not draggable |

CSS behavior:

```css
.topbar {
  -webkit-app-region: drag;
}

.topbar button,
.topbar [data-no-drag] {
  -webkit-app-region: no-drag;
}
```

### Window Control Visual States

The right side shows custom controls in Electron only.

| Control | Icon | Action |
| --- | --- | --- |
| Minimize | `Minus` | Minimizes the window |
| Maximize | `Square` | Maximizes the window |
| Restore | `Copy` or overlapping square | Restores a maximized window |
| Close | `X` | Closes the window |

The close button should use a danger hover state. Minimize and maximize/restore should use neutral hover states.

In web mode, the TopBar remains visible but window controls are hidden.

---

## Status Message Model

Status messages are transient records stored in memory.

```ts
export type StatusLevel = "info" | "success" | "warn" | "danger";

export type StatusMessage = {
  id: string;
  text: string;
  level: StatusLevel;
  timestamp: number;
  source?: string;
};
```

### Fields

| Field | Required | Description |
| --- | ---: | --- |
| `id` | Yes | Unique message id |
| `text` | Yes | Human-readable status text shown in the TopBar/history |
| `level` | Yes | Severity/category of the message |
| `timestamp` | Yes | Creation time in milliseconds |
| `source` | No | Optional subsystem name, such as `MusicBrainz`, `Local Scan`, `Player` |

---

## Status Levels and Colors

Each status level uses a dedicated semantic color. The TopBar displays the level primarily through a small colored indicator, keeping the message text clean.

| Level | Meaning | Indicator | Recommended color |
| --- | --- | --- | --- |
| `info` | Neutral operational activity | Blue dot | `hsl(217 91% 60%)` |
| `success` | Completed operation | Green dot | `hsl(142 71% 45%)` |
| `warn` | Recoverable issue or degraded state | Amber dot or warning icon | `hsl(38 92% 50%)` |
| `danger` | Failed operation or user attention needed | Red dot or error icon | `hsl(0 72% 51%)` |

### Level Semantics

`info` should be used for normal ongoing work:

- `Fetching album art from MusicBrainz`
- `Scanning folder: Music/Rock`
- `Loading artist details`

`success` should be used when a meaningful operation completes:

- `Album cover cached`
- `Local library scan finished`
- `Artist metadata updated`

`warn` should be used for recoverable problems:

- `MusicBrainz request timed out, retrying`
- `Some tracks are missing metadata`
- `Connection is slow, buffering`

`danger` should be used for failures requiring attention:

- `Failed to fetch album cover`
- `Could not connect to origin`
- `Local scan stopped due to an error`

---

## Global Status Store

A Zustand store owns the global message list and exposes actions for the rest of the application.

### Store State

```ts
type StatusState = {
  messages: StatusMessage[];
  addMessage: (text: string, level?: StatusLevel, source?: string) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
};
```

### Store Behavior

1. `addMessage()` appends a new message to the list.
2. If `level` is omitted, it defaults to `info`.
3. Messages are ordered oldest to newest.
4. The latest message is the last item in the array.
5. The store keeps at most `200` messages.
6. When the list exceeds `200`, the oldest messages are dropped.
7. The store is not persisted to localStorage.

### Usage Example

```ts
useStatusStore.getState().addMessage(
  "Fetching album art from MusicBrainz",
  "info",
  "MusicBrainz"
);
```

For React components, the hook can be used directly:

```ts
const addMessage = useStatusStore((state) => state.addMessage);

addMessage("Local library scan finished", "success", "Local Scan");
```

---

## Latest Message Display

The TopBar shows only the latest status message.

### With Messages

```txt
● Fetching album art from MusicBrainz
```

Rules:

1. Show one colored level indicator.
2. Show the message text on a single line.
3. Truncate overflow with ellipsis.
4. Optionally show the source before the message in muted text when space allows.
5. Do not show timestamps in the compact TopBar state.

### Without Messages

When there are no status messages, the center area should remain calm and compact.

Recommended empty state:

```txt
All clear
```

The empty state should use muted text and no strong color.

---

## Message History Popover

Clicking the status message area opens a popover with recent messages.

### Popover Content

Each history row contains:

| Element | Description |
| --- | --- |
| Level indicator | Colored dot or icon |
| Level label | `Info`, `Success`, `Warn`, `Danger` |
| Message text | Full status text |
| Source | Optional subsystem label |
| Relative time | Example: `now`, `12s`, `3m`, `1h` |

### Popover Behavior

1. Newest messages appear first.
2. The list is scrollable when it exceeds available height.
3. The popover includes a `Clear` action.
4. `Clear` removes all messages and returns the TopBar to the empty state.
5. The popover closes when clicking outside or pressing Escape.
6. The popover must not block dragging outside its bounds.

---

## Visual States

### TopBar

| State | Visual behavior |
| --- | --- |
| Default | Subtle background, bottom border, latest message centered |
| Hover over status | Slightly brighter background on the status trigger |
| Status popover open | Status trigger appears active |
| No messages | Muted `All clear` text |
| Danger latest message | Red indicator, text remains foreground color |

### Window Controls

| State | Visual behavior |
| --- | --- |
| Default | Transparent button background |
| Hover minimize/maximize | Muted background |
| Hover close | Red background with readable foreground |
| Disabled/unavailable | Hidden in web mode |

---

## Accessibility

1. The status trigger is a button with an accessible label, such as `Open status message history`.
2. Window controls use accessible labels: `Minimize`, `Maximize`, `Restore`, `Close`.
3. Color is not the only meaning carrier in the history list: include a text label for each level.
4. The popover supports keyboard dismissal with Escape.
5. Focus should move naturally into the popover when opened and return to the trigger when closed.
6. Text contrast must meet readable contrast against the TopBar background.

---

## Integration Points

Any feature can publish messages via the status store. Recommended initial integration points:

| Area | Example messages |
| --- | --- |
| MusicBrainz client | Fetching/cached/failed album art and artist metadata |
| Local library scan | Scanning folder, scan finished, scan failed |
| Player engine | Buffering, playback recovered, stream failed |
| Origin controllers | Fetching artist, fetching album, connection errors |
| Settings | Origin saved, invalid configuration, reconnect required |

---

## Implementation Files

| File | Action | Purpose |
| --- | --- | --- |
| `electron/main.ts` | Modify | Use frameless window and expose window control IPC handlers |
| `electron/preload.ts` | Modify | Expose safe `windowControls` API to the renderer |
| `src/types/status-types.ts` | Create | Define status levels and message model |
| `src/stores/status.store.ts` | Create | Global transient status message store |
| `src/stores/index.ts` | Modify | Export the status store |
| `src/components/ui/popover.tsx` | Create | Shared popover primitive |
| `src/hooks/use-electron-window.ts` | Create | Renderer hook for window controls and maximize state |
| `src/features/topbar/topbar.tsx` | Create | TopBar UI, latest message, history, window controls |
| `src/styles/layout.css` | Modify | Add TopBar grid row and sizing variable |
| `src/App.tsx` | Modify | Render TopBar at the top of the app layout |

---

## Acceptance Criteria

1. Electron desktop builds no longer show the system title bar.
2. The custom TopBar is visible at the top of the app.
3. The window can be dragged from non-interactive TopBar areas.
4. Minimize, maximize/restore, and close controls work in Electron.
5. Window controls are hidden in web mode.
6. The latest status message appears as text in the TopBar.
7. Each status level uses its own color indicator.
8. Clicking the status area opens a message history popover.
9. The history popover shows previous messages newest-first.
10. The history popover includes a clear action.
11. Any part of the app can publish a message through `useStatusStore`.
12. The app passes TypeScript checks after implementation.

---

## Testing Plan

### Automated

Run:

```bash
npm run typecheck
```

### Manual

1. Start Electron development mode.
2. Confirm the native system title bar is gone.
3. Drag the window by the TopBar.
4. Click minimize, maximize/restore, and close controls.
5. Publish messages from DevTools:

```ts
useStatusStore.getState().addMessage("Fetching artist info", "info", "MusicBrainz");
useStatusStore.getState().addMessage("Album cover cached", "success", "MusicBrainz");
useStatusStore.getState().addMessage("Request timed out, retrying", "warn", "MusicBrainz");
useStatusStore.getState().addMessage("Failed to fetch album cover", "danger", "MusicBrainz");
```

1. Verify that the latest message appears in the TopBar.
2. Verify that each level uses the correct color.
3. Click the status text and verify the history popover.
4. Clear messages and verify the empty state.
5. Start web development mode and confirm that status still works without window controls.

---

## Open Questions

1. Should `danger` messages remain visible until explicitly cleared, even if newer `info` messages arrive?
2. Should repeated identical messages be collapsed into one row with a counter?
3. Should status messages support progress values for long-running operations like local scans?
4. Should the app identity area include only text, an icon, or the currently selected origin as well?
