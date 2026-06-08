# UX Spec: Playlist System

> **Status**: proposed
> **Created**: 2026-06-04
> **Target**: `selftify` — create, manage, and play saved playlists
> **Audience**: Designers, product, front-end

---

## Principles

- **Playlists are yours** — created locally, stored locally, no servers needed.
- **Always accessible** — the Playlists nav item is always visible in the sidebar.
- **Quick to create** — "Add to Playlist" from any song, or create from the Playlists page.

---

## 1. Sidebar Navigation

```
Home
Search
  ├── Local Files
  └── Online Search
Library
Playlists         ← NEW
Settings
```

The "Playlists" item shows a `ListMusic` icon. It is always visible regardless of origin.

Active state: highlighted background matching other nav items.

---

## 2. Playlist List Page

### Default State

```
┌─────────────────────────────────────────────────────────┐
│  Playlists                           [+ New Playlist]   │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │          │  │          │  │          │              │
│  │ My Jams  │  │ Chill    │  │ Workout  │              │
│  │ 12 songs │  │ 8 songs  │  │ 20 songs │              │
│  │ 2 days   │  │ 1 week   │  │ 3 days   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                         │
│  ┌──────────┐                                           │
│  │          │                                           │
│  │ Road Trip│                                           │
│  │ 5 songs  │                                           │
│  │ Today    │                                           │
│  └──────────┘                                           │
└─────────────────────────────────────────────────────────┘
```

### Empty State

```
┌─────────────────────────────────────────────────────────┐
│  Playlists                           [+ New Playlist]   │
│                                                         │
│             ┌──────────────────────────┐                │
│             │                          │                │
│             │    📋 No playlists yet   │                │
│             │                          │                │
│             │  Create your first       │                │
│             │  playlist to start       │                │
│             │  organizing your music.  │                │
│             │                          │                │
│             │  [Create Playlist]       │                │
│             │                          │                │
│             └──────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

### Card States

| State | Visual |
|---|---|
| **Default** | Card with muted icon background, playlist name, song count, relative date |
| **Hover** | Slight lift (shadow increase), play button overlay on the left |
| **Active** | Click navigates to detail page |

---

## 3. Playlist Detail Page

### With Songs

```
┌─────────────────────────────────────────────────────────┐
│  ← Back to Playlists                                    │
│                                                         │
│  My Jams                                                │
│  12 songs · Created 2 days ago                          │
│  [▶ Play All]  [🗑 Delete]  [✏ Rename]                  │
│                                                         │
│  #  Title            Artist        Album       Dur   ☓  │
│  ───────────────────────────────────────────────────    │
│  1  Song One         Artist A     Album X     3:45  ✕  │
│  2  Song Two         Artist B     Album Y     4:20  ✕  │
│  3  Song Three       Artist A     Album Z     5:10  ✕  │
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

### Empty State

```
┌─────────────────────────────────────────────────────────┐
│  ← Back to Playlists                                    │
│                                                         │
│  New Playlist                                           │
│  0 songs · Created just now                             │
│  [▶ Play All]  [🗑 Delete]                              │
│                                                         │
│             ┌──────────────────────────┐                │
│             │                          │                │
│             │   🎵 This playlist is    │                │
│             │   empty. Add songs from  │                │
│             │   the library or search. │                │
│             │                          │                │
│             └──────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Add to Playlist Dialog

Triggered from any song row (via a "+" button or context menu).

```
┌─────────────────────────────┐
│  Add to Playlist            │
│                             │
│  ┌─────────────────────┐   │
│  │ Search playlists... │   │
│  └─────────────────────┘   │
│                             │
│  ○ My Jams        12 songs │
│  ○ Chill           8 songs │
│  ○ Workout        20 songs │
│  ○ Road Trip       5 songs │
│                             │
│  ┌─────────────────────┐   │
│  │ [+ New Playlist]    │   │
│  └─────────────────────┘   │
│                             │
│  [Cancel]    [Add]          │
└─────────────────────────────┘
```

### States

| State | Behavior |
|---|---|
| **Dialog opens** | Focus shifts to search input (if many playlists) or first playlist |
| **No playlists** | Show only [+ New Playlist] option |
| **Song already in playlist** | Playlist shows a checkmark, disabled |
| **Search filters** | Filters playlist list in real-time |
| **Add clicked** | Closes dialog, brief success message via StatusStore |

---

## 5. Song Row — Add to Playlist Button

Each song in search results, album page, and artist page gets a `+` button:

```
┌──────────────────────────────────────────────┐
│  🖼  Song Name          Artist    3:45  [+ ☰]│
└──────────────────────────────────────────────┘
```

- `+` opens Add to Playlist dialog
- `☰` (handle) appears on hover for drag reorder (in playlist detail)

---

## 6. Transitions & Feedback

| Interaction | Duration | Notes |
|---|---|---|
| Playlist create | Instant | Appears in list immediately |
| Add song to playlist | ~150ms | Brief success status message |
| Delete playlist | Instant | Removes from list immediately |
| Card hover | 200ms | Shadow increase, smooth |
| Page transition | 200ms | Slide-in for detail page |

---

## 7. Responsive Behavior

### Mobile (< 768px)
- Playlist cards: single column, full width
- Add to Playlist dialog: full-screen bottom sheet style
- Playlist detail: full-width song list

### Desktop (≥ 768px)
- Playlist cards: 2-3 column grid
- Add to Playlist dialog: centered modal
- Playlist detail: constrained max-width

---

## 8. Accessibility

- All playlist actions are keyboard-navigable
- Focus returns to trigger element after dialog closes
- Delete actions require confirmation
- Song count and date are announced to screen readers
