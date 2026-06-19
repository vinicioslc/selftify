# Lyrics Feature — UX/UI Spec

## Overview

Display synchronized (karaoke-style) or plain text lyrics for the currently playing song. Lyrics are automatically fetched from internet providers (LRCLib, NetEase), with fallback to embedded MP3 tags or `.lrc` sidecar files from local library. Users can manually search, adjust timing offset, export, and configure display preferences.

## Entry Points

1. **Full-Screen Player tab** — New "Lyrics" tab in the right panel, alongside "Queue" and "Visualizer"
2. **Now Playing Page** — Lyrics section integrated into the now-playing layout
3. **Settings** — Lyrics configuration accessible from TopBar → Settings → Lyrics tab

## Layout (Full-Screen Player)

```
┌─────────────────────────────────────────────────────┐
│  [Queue]  [Lyrics★]  [Visualizer]                    │  ← Tabs
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Provided by LRCLib                         │   │  ← Credit line
│  │  "Song Name by Artist"                      │   │  ← Match info
│  │                                             │   │
│  │  When you're gone                          │   │
│  │  The pieces of my heart                    │   │
│  │  Are missing you                           │   │
│  │                                             │   │
│  │        ★ When you're gone ★                │   │  ← Active (highlighted)
│  │                                             │   │
│  │  The pieces of my heart                    │   │
│  │  Are missing you                           │   │
│  │  When you're gone                          │   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  [Search]  [-50] [ 0ms] [+50] [Export] [Clear]│  │  ← Actions
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## States

### 1. Loading State
- **Visual**: Centered `<Spinner>` (from shadcn or inline animation)
- **Text**: None visible during loading
- **Status**: `useStatusStore.addMessage("Searching lyrics for {song}...", "info", "Lyrics")`
- **Trigger**: On song change, after 500ms debounce

### 2. No Lyrics Found (Empty State)
- **Visual**: Centered text "No lyrics found" in `text-muted-foreground`
- **Animation**: After 3 seconds, text fades out (`opacity: 1 → 0` over 500ms)
- **Hover**: Faded-out text reappears when user hovers over the lyrics area
- **Action**: "Search" button in the actions bar remains available
- **Status**: `addMessage("No lyrics found for {song}", "info", "Lyrics")`

### 3. Unsynced Lyrics (Plain Text)
- **Visual**: Lines center-aligned, static scrollable container
- **Font**: Configurable `fontSizeUnsync` (default 24px)
- **Spacing**: Configurable `gapUnsync` (default 24px)
- **Credit**: Top line "Provided by {source}" (if `showProvider` enabled)
- **Match**: Second line `"{name} by {artist}"` (if `showMatch` enabled)
- **Scroll**: Always visible scrollbar on hover, hidden otherwise

### 4. Synced Lyrics (Karaoke Mode)
- **Visual**: Lines center-aligned, dynamic highlighting
- **Active line**: Larger configurable `fontSize` (default 24px), `text-foreground` color, subtle glow/shadow effect
- **Past lines**: `text-muted-foreground` (diminished)
- **Future lines**: `text-muted-foreground/50` (more diminished)
- **Auto-scroll**: Container scrolls smoothly to keep active line vertically centered
- **User scroll**: Pauses auto-scroll for 3 seconds after user-initiated scroll
- **Click to seek**: Click on any timestamped line → player seeks to that position
- **Timing**: Lines transition using `setTimeout` chains based on LRC timestamps + offset
- **Scrollbar**: Hidden by default, shown on hover

### 5. Error State
- **Visual**: Falls back to empty state "No lyrics found"
- **Status**: `addMessage("Failed to fetch lyrics: {error}", "warn", "Lyrics")`
- **Action**: Search button still available for manual override

## Interactions

### Offset Adjustment
- **Purpose**: Fine-tune sync between lyrics and audio
- **Controls**:
  - `[-50]` button: Decrease offset by 50ms (lyrics appear later)
  - `[+50]` button: Increase offset by 50ms (lyrics appear earlier)
  - Number input: Manual value entry (any integer ms)
- **Persistence**: Offset stored per-song in React Query cache
- **Status**: `addMessage("Lyric offset adjusted to {offset}ms", "info", "Lyrics")`

### Manual Search
- **Trigger**: Click "Search" button in actions bar
- **Modal**: Opens `LyricsSearchModal` (centered, 800px wide, 600px tall)
- **Layout**:
  ```
  ┌─────────────────────────────────────────────┐
  │  Song Name: [________________]  Artist: [_]  │
  ├──────────────────┬──────────────────────────┤
  │  Search Results  │  Preview                  │
  │                  │                          │
  │  Song A - Artist │  (synced or plain        │
  │    LRCLib — 95%  │   lyrics preview)         │
  │  Song B - Artist │                          │
  │    NetEase — 82% │                          │
  │                  │                          │
  ├──────────────────┴──────────────────────────┤
  │        [Cancel]  [Export]  [Apply★]          │
  └─────────────────────────────────────────────┘
  ```
- **Search**: Debounced 500ms, queries all enabled providers
- **Results**: Grouped by source, sorted by match score (highest first)
- **Score**: Displayed as percentage (e.g., "95%")
- **Sync status**: Label shows "Synchronized", "Unsynchronized", or "Unknown" per result
- **Preview**: Right panel shows lyrics content when result selected
- **Export**: Download selected lyrics as file (opens export modal)
- **Apply**: Override auto-fetch with this selection → close modal

### Export
- **Trigger**: Click "Export" in actions bar
- **Modal**: Opens `LyricsExportModal`
- **Controls**:
  - Toggle: "Synced format (.lrc)" / "Plain text (.txt)"
  - Offset: Number input (applied to exported timestamps)
  - Preview: Shows the formatted output (scrollable `<pre>` block)
  - "Download" button → triggers file download via `URL.createObjectURL`
- **File naming**: `{songName}.lrc` or `{songName}.txt`

### Clear/Refresh
- **Behavior**: Clears the current override and auto-fetched result, suppresses auto-fetch for the current song
- **UI**: Triggers re-fetch on next song change
- **Status**: `addMessage("Lyrics cleared for {song}", "info", "Lyrics")`

## Settings Configuration

In **Settings → Lyrics** (gear icon in TopBar or gear icon in lyrics panel):

### Display Settings
| Setting | Control | Default | Values |
|---------|---------|---------|--------|
| Font size (synced) | Number input | 24px | 12-72px, step 1 |
| Font size (unsynced) | Number input | 24px | 12-72px, step 1 |
| Gap between lines (synced) | Number input | 24px | 0-80px, step 1 |
| Gap between lines (unsynced) | Number input | 24px | 0-80px, step 1 |
| Alignment | Segmented control | Center | Left / Center / Right |
| Auto-follow playback | Switch | ON | ON/OFF |
| Show provider credit | Switch | ON | ON/OFF |
| Show match info | Switch | ON | ON/OFF |

### Fetch Settings
| Setting | Control | Default | Values |
|---------|---------|---------|--------|
| Enable lyrics fetching | Switch | ON | ON/OFF |
| Lyric sources | Multi-select | [NetEase, LRCLib] | LRCLib, NetEase |
| Prefer local lyrics | Switch | OFF | ON/OFF |

## Responsive Behavior

### Desktop (Electron)
- Full-size lyrics panel in full-screen player, min 400px width
- Actions bar at bottom, always visible
- Tab switching between Queue / Lyrics / Visualizer

### Mobile (Capacitor/Android)
- Lyrics fills the full-screen player content area (no sidebar)
- Actions bar collapses to icon-only mode on narrow screens
- Minimum touch targets: 44x44dp for all interactive elements

### Compact Layout
- When full-screen player is closed, no lyrics visible
- Player bar shows small "lyrics available" indicator (text icon) when current song has lyrics

## Animations

| Context | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Loading → Content | Fade in | 300ms | ease-out |
| Content → Empty | Fade out | 500ms | ease-in |
| Active line highlight | Color transition | 200ms | ease-out |
| Auto-scroll to active line | Smooth scroll | 500ms | ease-out |
| Tab switch (Queue/Lyrics/Vis) | Cross-fade | 200ms | ease-out |
| Modal open | Scale + fade | 200ms | ease-out |

## Accessibility

- All action buttons have `aria-label` with descriptive text
- Lyrics container: `role="region"` with `aria-label="Song lyrics"`
- Active line: `aria-current="step"` on the current lyric line
- Tab panel: proper `role="tabpanel"` with `aria-labelledby`
- Keyboard: Tab through actions, Enter/Space to activate
- Focus visible ring on all interactive elements
- Color contrast: Active line vs background meets WCAG AA (4.5:1)

## Visual Design Tokens

All visual styles use Tailwind CSS variables from `globals.css`:
- `text-foreground` — active line color
- `text-muted-foreground` — past/future lines
- `bg-background` / `bg-card` — container backgrounds
- `border-border` — dividers
- `rounded-md`, `rounded-lg` — border radius

No custom CSS modules — use Tailwind utility classes throughout.
