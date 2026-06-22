# Scrobble Config — UX/UI Spec

> **Scope**: User-facing behavior, layout, states, flows
> **Audience**: Designers, product, front-end
> **Depends on**: `scrobble-config.md`

---

## Layout

A new **"Scrobbling"** tab in the Settings page, placed **after "Ranking" and before "Artwork"** in the tab bar.

Inside the tab: a single `Card` containing a list of scrobble provider cards — one per enabled provider type.

### Provider Card (ListenBrainz)

```
┌─────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────┐│
│  │ ● ListenBrainz           [Enable/Disable]││
│  │   Submit plays to listenbrainz.org       ││
│  │   ┌─────────────────────────────────┐    ││
│  │   │ API Token                    │ │    ││
│  │   └─────────────────────────────────┘    ││
│  │   ── or ──                               ││
│  │   [ Get your token ] → opens profile     ││
│  │   ✓ Connected          (token saved)     ││
│  │   ⚠ Not configured    (token empty)      ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

---

## States

### Provider Card

| State | Condition | Visual |
|-------|-----------|--------|
| **Default (disabled)** | `enabled: false`, token doesn't matter | Card at 50% opacity. Toggle off. Token input visible but dimmed. |
| **Enabled, no token** | `enabled: true`, `token: ""` | Full opacity. Token input focused/highlighted. Warning message below input: *"Token required — scrobbling will not work without an API token."* |
| **Enabled, token present** | `enabled: true`, `token: "xxx..."` | Full opacity. Token input shows masked value (or toggle visibility). Green status text: *"✓ Connected"*. |
| **Enabled, invalid token** | Detected at runtime (future) | Red/orange status: *"✗ Auth failed — check your token"* — not part of this spec's implementation, placeholder UI only. |

### Token Input

| State | Behavior |
|-------|----------|
| **Empty** | Placeholder text: *"Paste your ListenBrainz API token"* |
| **Filled** | Shows token masked (type="password") with a toggle eye icon to reveal |
| **Saving** | No debounce — saved immediately on blur or when the user clicks "Save" in the dialog footer |

---

## User Flows

### First-time setup

1. User opens Settings → clicks **"Scrobbling"** tab.
2. Sees ListenBrainz card with toggle OFF.
3. Flips toggle ON → card becomes full opacity, token input focused.
4. User pastes token (from listenbrainz.org/profile).
5. Token is saved automatically (or on explicit save).
6. Status shows **"✓ Connected"**.

### Disabling

1. User flips toggle OFF.
2. Card dims to 50% opacity.
3. Token is preserved in storage — re-enabling restores it.

### Updating token

1. User edits the token field.
2. Old token replaced on save/blur.

---

## Responsive Behavior

| Breakpoint | Behavior |
|------------|----------|
| **Desktop (≥768px)** | Card uses `sm:max-w-md` or natural width within the settings container. Token input takes full width of card. |
| **Mobile (<768px)** | Same layout, full-width input. Toggle and token input stack vertically. Minimum touch target 44px. |

---

## Accessibility

- Toggle has `aria-label`: *"Enable ListenBrainz scrobbling"*
- Token input has `aria-label`: *"ListenBrainz API token"*
- Status text uses `aria-live="polite"` to announce connection state changes
- Tab order: toggle → token input → action buttons

---

## Consistency Rules

- Uses the same `Card`, `Switch`, `Input`, `Badge` shadcn components as the rest of the settings page
- Token input styling: same as the MusicBrainz Token (legacy) input in the Servers tab
- Provider list pattern identical to the Artwork Providers tab (toggle + config per provider)
- Empty state: *"No scrobble providers configured."* (if the providers record is empty — unlikely for v1)

---

## Animations

- Card opacity transition: `transition-opacity duration-200` (matches artwork provider pattern)
- No additional animations for v1
