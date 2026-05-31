# UX Spec: Player Bar Cover Behavior & Sidebar Cover Toggle

> **Status**: implemented  
> **Created**: 2026-05-30  
> **Target**: `selftify` — layout polish, cover toggle, animation behavior between bottom bar and sidebar  
> **Audience**: Designers, product managers, developers validating behavior against user expectations

---

## Principles

- **Album art is the hero** — cover images should be crisp, square, and consistent everywhere they appear.
- **No redundant information** — the same album art should never be visible in two places at once.
- **Motion with purpose** — animations communicate state changes and feel natural, never decorative or distracting.
- **Generous breathing room** — spacing around interactive elements prevents a cramped feel.

---

## 1. Bottom Player Bar

### 1.1 Position & Elevation

The bottom bar does not sit flush against the screen edge. A subtle gap elevates it slightly above the bottom, as if floating. This creates visual separation from the OS chrome and gives the layout room to breathe.

- Gap height: approximately **6px** of empty space below the bar
- On mobile, the gap scales down proportionally

### 1.2 Layout (left to right)

| Zone | Content | Behavior |
|---|---|---|
| **Left — Cover** | Album cover art (always a perfect square) | Slides out when sidebar shows the cover; slides in when sidebar hides it |
| **Left — Text** | Track name (top, bold) + Artist name (bottom, muted) | Names are clickable — navigate to album and artist pages |
| **Left — Toggle** | Visualizer icon (🎨 or ▫) | Toggles the visualizer overlay on/off |
| **Center** | Play/pause, prev/next, progress slider | Always visible |
| **Right** | Volume, queue, shuffle, repeat, output menu | Always visible |

### 1.3 Cover Animation

The album cover in the bottom bar **slides horizontally** in sync with the sidebar cover state:

- **Sidebar cover visible →** bottom bar cover slides left and disappears. Only track info remains.
- **Sidebar cover hidden →** bottom bar cover slides in from the left. Track info shifts to accommodate.

The animation is smooth and lasts approximately **300ms**. It only affects the cover — text and controls never jump or reposition abruptly.

### 1.4 Cover Hover State

When the bottom bar cover is visible and the user hovers over it:

- A semi-transparent dark overlay fades in
- A **ChevronUp** icon appears in the center
- Clicking the icon **expands the cover in the sidebar** (and consequently hides the bottom bar cover)

This is the primary (and only) way to re-expand the sidebar cover once collapsed.

### 1.5 Cover Click

Clicking the album cover in the bottom bar does **nothing** — it does not navigate anywhere. This prevents accidental navigation conflicts with the track name and artist name links right next to it.

---

## 2. Sidebar Cover Section

### 2.1 States

| State | What the user sees |
|---|---|
| **Expanded** (default) | A separator line, then the album cover (or visualizer) filling the sidebar width, with small control buttons in the top-right corner |
| **Collapsed** | Nothing — the sidebar navigation fills all available space. No separator, no text, no empty bar |

### 2.2 Controls on the Cover

Two small buttons sit in the top-right corner of the expanded cover area:

| Button | Icon | Action |
|---|---|---|
| **Visualizer toggle** | Album icon / Sparkle icon | Switches between album art and a real-time music visualizer |
| **Collapse** | ChevronDown | Collapses the cover section entirely — frees up vertical space for navigation |

The collapse button is **semi-transparent** by default and becomes fully opaque on hover over the cover area.

### 2.3 When Collapsed

The sidebar shows no trace of the cover section — no separator line, no padding, no residual space. The navigation items expand to fill the gap naturally. The only way to restore the cover is via the ChevronUp button on the **bottom bar cover** (see 1.4).

### 2.4 Cover & Visualizer Content

- **Album art**: fills the space as a perfect square (`aspect-ratio: 1/1`), no rounded corners
- **Visualizer**: replaces the album art entirely, same square dimensions, with a dark semi-transparent background

Neither the album art nor the visualizer are clickable — they do not navigate to now-playing or any other view.

---

## 3. Dual-Cover Visibility Rule

Album art is always visible in **exactly one place**, never both:

| Sidebar cover | Bottom bar cover |
|---|---|
| Visible | Hidden |
| Hidden | Visible |

This eliminates visual redundancy and lets the user choose which screen real estate the cover occupies — large in the sidebar or compact in the bottom bar.

---

## 4. Artist Page

### 4.1 Page Layout

```
┌─────────────────────────────────────┐
│  [← Back]                           │  ← thin bar
├─────────────────────────────────────┤
│        ┌────┐                       │
│        │    │  Artist Name           │  ← hero section
│        │    │  3 albums · 24 songs   │
│        └────┘  [▶ Play All] [🔀]    │
├─────────────────────────────────────┤
│  Genre  Genre  Genre                 │  ← optional badges
├─────────────────────────────────────┤
│  About                               │  ← optional biography
│  Artist biography text...            │
├─────────────────────────────────────┤
│  ┌──┐ Album Name          3 tracks ▶│  ← discography (scrollable)
│  │  │ 1. Song title           3:45 ▶│
│  │  │ 2. Song title           4:12 ▶│
│  └──┘ 3. Song title           2:58 ▶│
│                                     │
│  ┌──┐ Another Album        5 tracks ▶│
│  │  │ 1. Song title           3:21 ▶│
│  │  │ 2. Song title           5:07 ▶│
│  └──┘ ...                            │
└─────────────────────────────────────┘
```

### 4.2 Background

A large, **heavily blurred** version of the artist image fills the hero section behind the content:

- Blur is strong enough that the image reads purely as color and texture, not as a recognizable picture
- A dark overlay on top ensures text remains readable regardless of the image brightness
- The background is **scaled up** (about 1.5×) to prevent hard edges from the blur

### 4.3 Rotation Animation

When **animations are enabled** globally:

| State | Background behavior |
|---|---|
| Artist's music is playing | Slowly rotates (one full revolution every **40 seconds**) |
| Artist's music is paused | Freezes at the exact current angle — no jump or reset |
| Different artist is playing | Frozen at current position |
| No music is playing | Frozen at current position |
| User navigates to another artist | New background starts fresh (no continuity across different artists) |

When **animations are disabled**, the background is a static blurred image — no rotation at all.

### 4.4 Artist Avatar

The artist avatar appears in the hero section as a **square** (not circular) image with subtle rounded corners — consistent with all other cover images in the app. It is large and prominent:

- Mobile: ~160px × 160px
- Desktop: ~192px × 192px

---

## 5. Visual Consistency — Avatars vs. Covers

All cover images and artist/album thumbnails share the same shape: **square with slight rounding (`rounded-md`)**. This applies to:

- Artist avatars on the artist page
- Album thumbnails on the artist page discography
- Artist/album images in search results
- Artist/album images in the library
- The "no track" placeholder in the bottom bar

The only exceptions are **circular play buttons** (play/pause controls), which remain round as a standard UI convention.

---

## 6. Empty States

| Scenario | What the user sees |
|---|---|
| **No track playing** | Bottom bar left section shows a placeholder square with a musical note icon and "No track playing" text |
| **No album art available** | A muted square with the first letter of the album/artist name as a fallback |
| **Artist with no songs** | Hero section is shown with album/song counts absent or zero, no discography section, "No songs found for this artist." message |
| **Album with no songs** | Hero section shown, "No songs found in this album." message |

---

## 7. Transitions & Motion Guidelines

| Interaction | Duration | Curve | Notes |
|---|---|---|---|
| Bottom bar cover slide in/out | 300ms | ease-in-out | Smooth deceleration, no bounce |
| Sidebar cover mount/unmount | Instant | — | No animation — content appears/disappears immediately as the gap closes |
| ChevronUp overlay fade | 200ms | ease | Hover in: overlay + icon fade up. Hover out: fade down |
| ChevronDown button opacity | 200ms | ease | Semi-transparent → opaque on group hover |
| Artist background rotation | 40s/rev | linear | Slow enough to be barely perceptible, creates a subtle living texture |

---

## 8. User Flows

### 8.1 Collapsing the sidebar cover

1. User is browsing the sidebar while a track plays
2. They see the album cover at the bottom of the sidebar
3. They click the **ChevronDown** button in the top-right of the cover
4. The cover section disappears instantly
5. The bottom bar cover **slides in** from the left, filling the gap
6. Navigation items in the sidebar occupy the freed vertical space
7. The user now has more room for navigation while still seeing album art in the bottom bar

### 8.2 Re-expanding the sidebar cover

1. User wants to see the album art larger in the sidebar
2. They **hover** over the cover in the bottom bar
3. A dark overlay with a **ChevronUp** icon appears
4. They click the ChevronUp
5. The bottom bar cover **slides out** to the left
6. The sidebar cover section **appears** with the album art
7. The user can now see the full-size cover while navigating

### 8.3 Browsing an artist page

1. User clicks an artist name anywhere in the app
2. They land on the artist page with a large blurred background
3. If animations are enabled and this artist's music is playing, the background slowly rotates
4. They can play all songs, shuffle, or browse albums grouped by album
5. They click an album name or thumbnail to go to the album page
6. They click "Back" to return to the previous view
