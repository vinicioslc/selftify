# Spec: Player Bar Cover Behavior & Sidebar Cover Toggle

> **Status**: implemented  
> **Created**: 2026-05-30  
> **Target**: `selftify` — layout polish, cover toggle, animation behavior between bottom bar and sidebar

---

## Problem

Several visual and interaction issues:

1. **Artist page rotation**: Background blur was too subtle (30px), rotation too fast (20s), and animation reset when toggling play/pause (CSS class toggling restarted the animation from 0°)
2. **Bottom bar flush**: The player bar sat flush against the viewport bottom edge with no breathing room
3. **Album cover not square**: The bottom bar cover used `w-auto`, so non-square images appeared distorted
4. **Round avatars everywhere**: All avatars used `rounded-full` (circular), inconsistent with the square album/artist card thumbnails (`rounded-md`)
5. **Cover click → now-playing**: Clicking the bottom bar cover navigated to the now-playing page, overriding other click behaviors (album/artist name clicks)
6. **Sidebar cover bar on collapse**: When the sidebar cover was collapsed, a track-info "bar" remained visible, wasting vertical space
7. **Cover duplication**: Album art appeared in both the sidebar (large) and bottom bar (small) simultaneously — redundant

---

## Solution

### 1. Artist Page — background rotation with position freeze

**Driver**: `src/features/artist/artist-page.tsx`

| Before | After |
|---|---|
| `blur(30px)` | `blur(60px)` |
| `animationDuration: 20s` | `animationDuration: 40s` |
| Always spinning (no animation toggle, no `animationsEnabled` check) | Gated by `animationsEnabled` setting from `useSettingsStore()` |
| Conditional `animate-spin` class toggled on play/pause (animation reset on toggle) | `animate-spin` class controlled by `animationsEnabled`, animation pause controlled by `animationPlayState` |
| `isPaused ? "paused" : "running"` (mismatched edge cases) | `isArtistPlaying && status === "playing" ? "running" : "paused"` — only the playing artist's page spins; pause freezes at exact current rotation angle |

Animation is only applied when `animationsEnabled` is true (global setting):

```tsx
className={`h-full w-full object-cover ${animationsEnabled ? "animate-spin" : ""}`}
style={{
  filter: "blur(60px)",
  ...(animationsEnabled && {
    animationDuration: "40s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    animationPlayState: isArtistPlaying && status === "playing" ? "running" : "paused",
  }),
}}
```

Behavior:
- `animationsEnabled = true` + playing the artist's music → rotates slowly (40s per revolution)
- `animationsEnabled = true` + pause → freezes at the exact rotation angle (CSS `animation-play-state: paused`)
- `animationsEnabled = true` + stopped or different artist → frozen at current position
- `animationsEnabled = true` + navigating to a different artist → new image, new animation starting from 0°
- `animationsEnabled = false` → no rotation at all, static blurred image

---

### 2. Bottom bar elevation

**Driver**: `src/styles/layout.css`

```css
.layout {
  padding-bottom: 6px;
  box-sizing: border-box;
}
```

The `.layout` grid container gets `padding-bottom: 6px` with `box-sizing: border-box` so the total height stays at 100%. The `overflow: hidden` clips extra space. The player bar sits 6px above the viewport bottom edge.

---

### 3. Bottom bar cover — always square

**Driver**: `src/features/player/components/left-controls.tsx`

```tsx
<!-- Before -->
className="h-full w-auto object-cover"

<!-- After -->
className="h-full aspect-square object-cover"
```

Changed from `w-auto` (width follows image natural aspect ratio, can be non-square) to `aspect-square` (CSS forces 1:1 ratio based on the height set by the parent container).

---

### 4. Remove border radius from avatars

**Driver**: `src/components/ui/avatar.tsx` + overrides

| File | Before | After |
|---|---|---|
| `avatar.tsx` (base) | `rounded-full` | `rounded-md` |
| `artist-page.tsx` | `rounded-full shadow-lg` | `shadow-lg` (inherits `rounded-md` from base) |
| `left-controls.tsx` (no-track placeholder) | `rounded-full` | `rounded-md` |
| `search-page.tsx` | `rounded-full` on avatar | `rounded-md` |

Play button circles (`center-controls.tsx`, `full-screen-player.tsx`, `now-playing-page.tsx`) keep `rounded-full` — they are UI controls, not cover images.

---

### 5. Bottom bar cover — behavior changes

**Driver**: `src/features/player/components/left-controls.tsx`

#### 5a. Remove now-playing navigation

The `onClick={() => onNavigate?.("now-playing")}` on the cover `<Button>` was removed entirely. Clicking the cover does nothing; navigation to now-playing is handled by other UI elements (e.g. double-click, dedicated button).

The `onNavigate` prop remains in the component's type signature but is no longer used internally — candidate for future cleanup.

#### 5b. Structural changes for square cover

The cover is now wrapped in an explicit-width square container:

```tsx
<div style={{ width: "var(--player-bar-height)", height: "100%" }}>
  <Button variant="ghost" className="h-full w-full shrink-0 overflow-hidden rounded-none p-0">
    <Avatar
      src={currentTrack.imageUrl}
      alt={currentTrack.name}
      fallback={currentTrack.name.charAt(0)}
      className="h-full w-full object-cover"
    />
  </Button>
</div>
```

Changes from previous implementation:
- **Outer div**: added `width: var(--player-bar-height)` to guarantee a square reference frame
- **Button**: added `w-full` (was missing, causing circular dependency with Avatar `w-auto`)
- **Avatar**: `h-full w-auto object-cover` → `h-full w-full object-cover`. Combined with the explicit `width` on the parent div, this ensures the Avatar fills the square container without circular dependency

#### 5c. Animated show/hide based on sidebar cover state

The entire cover block (outer div + Button + Avatar + hover overlay) is wrapped in an animated container:

```tsx
<div
  className="overflow-hidden transition-all duration-300 ease-in-out"
  style={{
    width: sidebarAlbumCollapsed ? "var(--player-bar-height)" : "0px",
    opacity: sidebarAlbumCollapsed ? 1 : 0,
    flexShrink: 0,
  }}
>
  <!-- cover block -->
</div>
```

| `sidebarAlbumCollapsed` | Container width | Container opacity | Visual |
|---|---|---|---|
| `true` (hidden in sidebar) | `var(--player-bar-height)` | 1 | Cover visible + ChevronUp on hover |
| `false` (visible in sidebar) | `0px` | 0 | Cover hidden (slides left) |

#### 5d. ChevronUp expand overlay

The ChevronUp overlay (to re-expand the sidebar cover) is **always rendered** in the DOM, not conditionally. It is visually hidden when the container is collapsed (`width: 0; opacity: 0; overflow: hidden`):

```tsx
<div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/50 group-hover:opacity-100">
  <Button onClick={(e) => { e.stopPropagation(); setSidebarAlbumCollapsed(false); }}>
    <ChevronUp className="h-5 w-5" />
  </Button>
</div>
```

- Visible on hover over the cover (when `sidebarAlbumCollapsed = true`)
- Not interactive when `sidebarAlbumCollapsed = false` (container collapsed, pointer-events none due to `overflow: hidden`)

#### 5e. Visualizer toggle

The visualizer toggle button (`🎨` / `▫`) is always visible regardless of sidebar cover state. It sits after the track info text, outside the animated cover container.

---

### 6. Sidebar cover — no bar on collapse

**Driver**: `src/features/sidebar/sidebar.tsx`

```tsx
<!-- Before -->
{currentTrack && (
  <>
    <Separator />
    <div className="group relative p-3">
      <!-- cover content with slide animation -->
      ...
    </div>
    {sidebarAlbumCollapsed && (
      <div className="flex items-center gap-2">
        <!-- track info + expand button (wasted space) -->
      </div>
    )}
  </>
)}

<!-- After -->
{currentTrack && !sidebarAlbumCollapsed && (
  <>
    <Separator />
    <div className="group relative p-3">
      <!-- cover content (no slide animation wrapper needed) -->
      ...
    </div>
  </>
)}
```

Changes:
- Condition changed from `currentTrack && (` to `currentTrack && !sidebarAlbumCollapsed && (`
- Removed the collapsed-state track info section entirely (lines 276-324), which included:
  - Track name link (`onNavigateAlbum` handler + `onNavigate` fallback)
  - Artist name link (`onNavigateArtist` handler)
  - ChevronUp expand button
- Removed slide animation wrapper (unnecessary — component mounts/unmounts with the conditional)
- Removed `onClick={() => onNavigate("now-playing")}` from:
  - Album cover `<div>` (also removed `cursor-pointer`)
  - Visualizer `<div>` (also removed `cursor-pointer`)
- Removed Disc3 icon hover overlay on album cover (the `<div>` overlay with `Disc3` icon and `group-hover` transition)
- No separator, no padding, no content rendered when collapsed — zero visual footprint

The expand button now lives exclusively on the bottom bar cover (hover overlay in left-controls). Users click the ChevronUp on the bottom bar cover to re-expand the sidebar cover.

---

### 7. Dual-state cover visibility matrix

| `sidebarAlbumCollapsed` | Sidebar | Bottom bar |
|---|---|---|
| `true` (collapsed) | Nothing (zero footprint) | Cover visible + track info |
| `false` (expanded) | Separator + cover with controls | Only track info (cover hidden) |

This eliminates redundant cover display while keeping album art always accessible.

---

## Files Changed

| File | Changes |
|---|---|
| `src/features/artist/artist-page.tsx` | Blur 30→60px, duration 20→40s; `animate-spin` gated by `animationsEnabled` setting; always `animate-spin` when enabled, control pause via `animationPlayState` |
| `src/styles/layout.css` | `padding-bottom: 6px; box-sizing: border-box` on `.layout` |
| `src/features/player/components/left-controls.tsx` | Removed now-playing navigation; animated cover show/hide based on `sidebarAlbumCollapsed`; explicit `width: var(--player-bar-height)` wrapper; `w-auto` → `w-full` on Avatar; ChevronUp overlay always rendered (no condition) |
| `src/components/ui/avatar.tsx` | `rounded-full` → `rounded-md` |
| `src/features/artist/artist-page.tsx` | Removed `rounded-full` override from artist avatar class |
| `src/features/player/components/left-controls.tsx` | Changed no-track placeholder `rounded-full` → `rounded-md` |
| `src/features/search/search-page.tsx` | Changed avatar `rounded-full` → `rounded-md` |
| `src/features/sidebar/sidebar.tsx` | Only render cover section when expanded (`!sidebarAlbumCollapsed`); removed collapsed bar (track info + expand button); removed `onClick="now-playing"` from cover and visualizer; removed `cursor-pointer`; removed Disc3 hover overlay |

---

## Edge Cases & States

| State | Behavior |
|---|---|
| **No track playing** | Left controls shows placeholder (♪ icon + "No track playing"). No sidebar cover section |
| **Cover hidden in sidebar + track playing** | Bottom bar shows cover with hover-expand button. Sidebar shows only navigation (no track section) |
| **Cover visible in sidebar + track playing** | Sidebar shows album art + toggle/collapse buttons. Bottom bar shows only text |
| **Toggle sidebar collapse while playing** | 300ms transition on bottom bar cover (slide out/in). Sidebar section mounts/unmounts immediately (no animation — gap filled by ScrollArea) |
| **Artist page rotation with animations enabled** | Spins only on play, freezes at exact CSS rotation angle on pause. Different artist or stopped = frozen |
| **Artist page rotation with animations disabled** | No rotation — static blurred image. `animate-spin` class not applied, animation styles not injected |
| **Non-square cover images** | `aspect-square` on Avatar outer container forces 1:1 ratio in bottom bar. Sidebar uses `aspectRatio: "1/1"` inline style |
| **Search/library artist avatars** | `rounded-md` (square with slight rounding), matches album thumbnail style |
| **Bottom bar cover hidden (sidebar expanded)** | Cover container is `width: 0; opacity: 0; overflow: hidden`. The ChevronUp overlay is in DOM but clipped. Text info still visible |
| **Hover on bottom bar cover (sidebar collapsed)** | Overlay appears: dark background + white ChevronUp icon. Clicking expands the sidebar cover |

## Future Cleanup

| Item | Reason |
|---|---|
| **`onNavigate` prop in `LeftControls`** | No longer used after removing cover navigation. Still present in type signature and passed from `PlayerBar` / `App.tsx`. `RightControls` still uses it. Could be removed from `LeftControls` props and `PlayerBar`'s left section pass |
| **Collapsed bar navigation handlers** | `onNavigateAlbum` and `onNavigateArtist` were removed from sidebar's collapsed bar along with the bar itself. No functional impact — these handlers are still available via bottom bar text links |
