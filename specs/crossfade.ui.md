# UX Spec: Crossfade / Transition Mixing

> **Status**: proposed
> **Created**: 2026-06-04
> **Target**: `selftify` — smooth audio transitions between tracks
> **Audience**: Designers, product, front-end

---

## Principles

- **No abrupt cuts** — when transition mixing is on, tracks blend into each other.
- **Configurable, not automatic** — user chooses the style (on/off, duration).
- **Visually evident** — the player bar shows when a crossfade is in progress.
- **Genre-appropriate** — longer fades (5–8s) for ambient/classical; shorter for pop/rock.

---

## 1. Settings Panel — Playback Tab

### Current State (before change)

```
Playback Settings
┌──────────────────────────────────────────────┐
│  Audio Output: [▼ Default Device         ]   │
│  Auto-switch output: [toggle]                │
│                                              │
│  Crossfade:              [toggle]            │
│  Crossfade duration:     [═══●══════] 3s     │
└──────────────────────────────────────────────┘
```

### New State (after change)

```
Playback Settings
┌──────────────────────────────────────────────┐
│  Audio Output: [▼ Default Device         ]   │
│  Auto-switch output: [toggle]                │
│                                              │
│  ── Transitions ──                           │
│  Transition Mixing:         [toggle]         │
│  Transition duration:       [═══●══════] 3s  │
│    (0s = instant, max 12s)                   │
└──────────────────────────────────────────────┘
```

### Component States

| Element | State | Visual |
|---------|-------|--------|
| **"Transition Mixing" label** | default | `text-sm font-medium text-foreground` |
| **Toggle switch** | on | Primary color (blue) |
| | off | Muted gray |
| **Duration slider** | enabled | Active, with `--primary` fill |
| | disabled (toggle off) | Grayed out, opacity-50 |
| **Duration value label** | default | `e.g. "3s"` inline beside slider |
| **Helper text** | always | `"(0s = instant, max 12s)"` in `text-muted-foreground` |
| **Slider range** | always | 0 to 12, step 0.5 |

### Empty / Zero State

When duration is set to `0s`, the feature behaves identically to disabled (instant switch). The toggle can still be on — this allows the user to quickly adjust from 0 to a positive value without re-enabling the toggle.

---

## 2. Player Bar — Crossfade Indicator

### During a crossfade transition

When a crossfade is actively in progress (between two tracks), the player bar shows a temporary indicator:

```
┌─────────────────────────────────────────────────────────┐
│  ♫ Song A — fading out ░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓ 3.2s   │
│  ♫ Song B — fading in  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░ 1.8s   │
│  [▶] [───●─────────] [3:42]                             │
└─────────────────────────────────────────────────────────┘
```

The indicator appears **below the song title** (or replaces the progress area) and shows:

- **Left side**: Outgoing song name + fade-out progress bar
- **Right side**: Incoming song name + fade-in progress bar
- **Total time remaining** for the crossfade

After the transition completes, the indicator disappears and the player bar returns to normal (showing only Song B).

### Visual states

| State | What shows in player bar |
|-------|--------------------------|
| Normal playback | Current track info only |
| Crossfade in progress | Dual-track indicator (see above) |
| Crossfade complete | Current track info (incoming) |

---

## 3. Visual Feedback

### Progress bar styling

```
Fade-out bar (outgoing):
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← empty at start
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← mid-point
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← complete

Fade-in bar (incoming):
  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← early
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░  ← mid-point
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ← complete
```

### Color scheme

- Outgoing indicator: `text-muted-foreground` (dimmed, fading away)
- Incoming indicator: `text-foreground` (bright, arriving)
- Progress fill: `bg-primary` (accent blue)
- Progress track: `bg-muted`

---

## 4. Interaction Rules

| Action | Behavior |
|--------|----------|
| Toggle "Transition Mixing" ON | Reading saved `crossfadeDuration` from store; slider becomes active |
| Toggle "Transition Mixing" OFF | Hard-stop behavior restored immediately (even mid-crossfade) |
| Drag duration slider to 0 | Instant transition, but toggle stays on (user can slide back up) |
| Drag duration slider to 12 | Max transition length |
| Close settings and play next track | New duration applies on next transition |
| Change duration mid-playback | Next transition uses new value |

---

## 5. Responsive / Mobile

On mobile (≤768px):
- Settings layout adapts to single column (already handled by shadcn Card)
- Slider remains full-width
- Player bar crossfade indicator shows a simplified version:
  - Only "Crossfading..." text with a single progress bar
  - No dual-track labels (screen too narrow)

---

## 6. Accessibility

- Slider is keyboard-navigable (arrows to adjust by step=0.5)
- Toggle has `aria-label="Enable transition mixing"`
- Crossfade indicator uses `role="progressbar"` with `aria-valuenow`
- All color indicators have sufficient contrast against background
