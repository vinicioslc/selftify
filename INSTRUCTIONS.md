# YT Music Player — Architecture & Development Guide

> **LEGAL NOTICE:** This project must NEVER mention, reference, or allude to "Feishin", "feishin", or any related products, concepts, trademarks, or projects in any code, documentation, comments, commit messages, issue titles, or any other communication. This includes, but is not limited to: Feishin, Navidrome, Jellyfin, Subsonic, or any self-hosted music player project. This restriction is necessary to avoid jurisdiction under USA laws. Treat this project as an independent entity with no relation to any other music player software.

## Overview

Cross-platform music player targeting **Android** and **Desktop** (Linux/macOS/Windows) with support for:

| Source     | Type         | Auth Method                  |
|------------|--------------|------------------------------|
| Navidrome  | Subsonic API | Password / Token             |
| Jellyfin   | Jellyfin API | Username + Password → Token  |
| YouTube Music | InnerTube (youtubei.js) | Browser cookies (Netscape format) |
| Local Files | MP3 scan     | Tauri plugin-fs (device storage) |

Built with **React 19 + TypeScript + Vite + Tailwind CSS v3 + shadcn/ui** on **Tauri v2**.

---

## Project Structure

```
yt-music-player/
├── index.html                  # Vite entry HTML
├── package.json                # Dependencies & scripts
├── tsconfig.json               # TypeScript config (web)
├── tsconfig.node.json          # TypeScript config (node/Vite)
├── vite.config.ts              # Vite config with Tauri mobile support
├── tailwind.config.ts          # Tailwind with shadcn theme vars
├── postcss.config.js           # PostCSS + Tailwind + Autoprefixer
├── components.json             # shadcn/ui config
├── INSTRUCTIONS.md             # This file
│
├── src/                        # ——— REACT FRONTEND ———
│   ├── main.tsx                # React entry + QueryClient
│   ├── App.tsx                 # Root: auth gate, layout, view routing
│   ├── vite-env.d.ts
│   │
│   ├── api/                    # ——— API LAYER ———
│   │   ├── controller.ts       # Unified ServerController interface
│   │   ├── index.ts            # Barrel (getController)
│   │   ├── navidrome/          # Navidrome/Subsonic API
│   │   │   ├── navidrome-api.ts
│   │   │   └── navidrome-controller.ts
│   │   ├── jellyfin/           # Jellyfin API
│   │   │   ├── jellyfin-api.ts
│   │   │   └── jellyfin-controller.ts
│   │   ├── youtube/            # YouTube Music API
│   │   │   ├── youtube-api.ts  # InnerTube client + cookie auth
│   │   │   └── youtube-controller.ts
│   │   └── local/              # Local file scanner
│   │       └── local-controller.ts
│   │
│   ├── stores/                 # ——— STATE (Zustand + persist) ———
│   │   ├── auth.store.ts       # Servers list, current server selection
│   │   ├── player.store.ts     # Queue, playback, volume, shuffle, repeat
│   │   ├── settings.store.ts   # Theme, visualizer, playback prefs
│   │   └── index.ts
│   │
│   ├── types/                  # ——— TYPE DEFINITIONS ———
│   │   ├── domain-types.ts     # Song, Album, AlbumArtist, Playlist, enums
│   │   ├── types.ts            # UI types (ServerConfig, AppView, etc.)
│   │   └── butterchurn.d.ts    # Declarations for butterchurn, tauri-fs
│   │
│   ├── lib/
│   │   └── utils.ts            # cn(), formatDuration(), formatCount(), etc.
│   │
│   ├── components/ui/          # ——— SHADCN COMPONENTS ———
│   │   ├── button.tsx, card.tsx, input.tsx, avatar.tsx
│   │   ├── badge.tsx, slider.tsx, separator.tsx, switch.tsx
│   │   ├── tabs.tsx, dialog.tsx, scroll-area.tsx
│   │
│   ├── features/               # ——— FEATURE MODULES ———
│   │   ├── home/
│   │   │   └── home-page.tsx   # Initial screen: server cards + quick actions
│   │   ├── sidebar/
│   │   │   └── sidebar.tsx     # Collapsible nav + server list
│   │   ├── player/
│   │   │   ├── player-bar.tsx          # Bottom player bar
│   │   │   ├── full-screen-player.tsx  # Immersive now-playing overlay
│   │   │   └── web-audio-provider.tsx  # <audio> + Web Audio API bridge
│   │   ├── visualizer/
│   │   │   ├── visualizer-container.tsx # Switches between engines
│   │   │   ├── butterchurn-visualizer.tsx  # MilkDrop-style (GPU)
│   │   │   └── audiomotion-visualizer.tsx  # Spectrum analyzer
│   │   ├── search/
│   │   │   └── search-page.tsx  # Search songs/albums/artists
│   │   ├── library/
│   │   │   └── library-page.tsx # Browse by server
│   │   ├── auth/
│   │   │   └── auth-page.tsx   # Server connection forms
│   │   └── settings/
│   │       └── settings-page.tsx # Tabs: Servers, Playback, Visualizer, Theme
│   │
│   ├── hooks/                  # React hooks (add as needed)
│   └── styles/
│       └── globals.css         # Tailwind + shadcn CSS variables (dark/light)
│
└── src-tauri/                  # ——— TAURI v2 (RUST) ———
    ├── Cargo.toml              # Rust deps (tauri 2, plugins)
    ├── build.rs                # tauri_build::build()
    ├── tauri.conf.json         # App config, window, bundle
    ├── capabilities/
    │   └── default.json        # Permissions (fs, shell, notification)
    ├── icons/                  # App icons (need to be generated)
    └── src/
        ├── main.rs             # Desktop entry → calls lib::run()
        └── lib.rs              # Shared entry (mobile + desktop)
```

---

## Architecture Decisions

### 1. Tauri v2 over Electron

| Aspect | Tauri v2 | Electron |
|--------|----------|----------|
| Binary size | ~5 MB | ~150 MB |
| Android | ✅ Native (System WebView) | ❌ |
| Desktop | ✅ Linux/Mac/Windows | ✅ |
| RAM usage | ~50 MB | ~200 MB |
| Frontend | Any web framework | Any web framework |
| Backend | Rust | Node.js |

### 2. Web Audio API for audio playback

All audio goes through the browser's `<audio>` element, connected to an `AudioContext` via `createMediaElementSource()`. This gives us:
- The `AnalyserNode` for visualizers (butterchurn, audiomotion)
- Cross-platform compatibility (mobile + desktop)
- No native audio plugins needed

The `WebAudioProvider` component wraps the app and manages:
- `Audio` element lifecycle
- `AnalyserNode` for visualizer data
- Play/pause, seek, volume via React state → audio element
- Track loading via `controller.getStreamUrl()`

### 3. Controller Pattern (Strategy)

```
┌───────────────────────────────────────────────────┐
│                  App.tsx                           │
│  getController() → ServerController               │
├───────────────────────────────────────────────────┤
│  ServerController interface:                      │
│  ─ authenticate()                                 │
│  ─ search()                                       │
│  ─ getAlbumDetail() / getAlbumList()              │
│  ─ getAlbumArtistDetail() / getAlbumArtistList()  │
│  ─ getSongDetail() / getSongList()                │
│  ─ getPlaylistDetail() / getPlaylistList()         │
│  ─ getStreamUrl() / getImageUrl()                  │
├─────────┬──────────┬──────────┬───────────────────┤
│ Navidrome│ Jellyfin │ YouTube  │ Local             │
│ Controller│Controller│Controller│Controller         │
└─────────┴──────────┴──────────┴───────────────────┘
```

Each controller translates its server's native API into the shared `Song`, `Album`, `AlbumArtist` domain types.

### 4. Zustand over Context

All global state uses Zustand with `persist` middleware (localStorage):
- **`auth.store`**: Server list + credentials
- **`player.store`**: Queue, current track, playback state
- **`settings.store`**: Theme, visualizer, playback preferences

### 5. Visualizers

Two engines, selectable in Settings:

| Engine | Description | GPU | Bundle impact |
|--------|-------------|-----|---------------|
| **Butterchurn** | MilkDrop-style (Winamp) | Heavy (WebGL) | ~840 KB |
| **AudioMotion** | Spectrum analyzer bars | Light (Canvas) | ~30 KB |
| **None** | Disabled | None | 0 KB |

Both read frequency data from the shared `AnalyserNode` exposed by `WebAudioProvider`.

---

## Development

### Prerequisites

- **Node.js** 20+ (uses Volta in package.json)
- **Rust** (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- **System deps** (Linux):
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- **Android Studio** (for mobile development)
  - SDK Platform, Platform-Tools, NDK, Build-Tools
  - Set `ANDROID_HOME` and `NDK_HOME`
  - Rust targets: `rustup target add aarch64-linux-android armv7-linux-androideabi`

### Commands

```bash
# Development (desktop)
npm run dev          # Vite dev server (web only)
npm run tauri:dev    # Full Tauri desktop app

# Build (desktop)
npm run build        # Production web build
npm run tauri:build  # Package desktop binary

# Android
npm run tauri:android:dev     # Run on connected device/emulator
npm run tauri:android:build   # Build APK

# Quality
npm run typecheck    # TypeScript check
npm run lint         # TSC + future linting
```

### Adding a shadcn component

```bash
npx shadcn@latest add button
# Or manually create: src/components/ui/<name>.tsx
# Follow shadcn conventions (cn() utility, Radix primitives, CVA variants)
```

---

## Platform-Specific Notes

### Android

- Audio continues in background via `Audio` element + Tauri WebView
- Lockscreen media controls: Tauri notification plugin
- File picker for local music: Tauri dialog plugin
- Touch targets: minimum 44x44 dp (shadcn defaults handle this)
- Bottom player bar is smaller on mobile (72px vs 90px)
- Full-screen player acts as the primary mobile "now playing" screen

### Desktop

- Keyboard shortcuts: space (play/pause), arrows (seek/next/prev)
- System media keys: Tauri handles via MPRIS (Linux) / MediaKeys API
- Resizable window with min 480x600
- Sidebar collapse for space efficiency

### Web

- The app can also run as a plain web app via `npm run dev`
- No Tauri features (local files, notifications) will work in web mode
- Stream URLs must be CORS-compatible for web use

---

## Future Enhancements (Roadmap)

1. **Lazy routes**: Code-split pages for faster initial load
2. **MusicBrainz integration**: Metadata enrichment
3. **Offline cache**: IndexedDB for lyrics + recently played
4. **Background audio service**: Tauri plugin for reliable Android bg playback
5. **Equalizer**: Web Audio API BiquadFilterNode
6. **Crossfade**: Web Audio API gain automation
7. **Smart playlists**: Rule-based auto-playlists (like Navidrome)
8. **Drag & drop**: @atlaskit/pragmatic-drag-and-drop for queue reordering
9. **Download/offline**: Cache streams locally via Tauri fs plugin
10. **Scrobbling**: Last.fm / ListenBrainz support

---

## Design Principles

- **No direct DOM manipulation**: All UI through React state + shadcn components
- **Minimal dependencies**: Only add what's needed
- **TypeScript strict**: Full type safety across API boundaries
- **Mobile-first responsive**: Tailwind breakpoints for adaptive layout
- **Server-agnostic UI**: Same components work with any backend
- **Observability**: Console.debug() with `[YT Music]` prefix for API calls
- **No cross-project references**: This project must never reference Feishin, Navidrome, Jellyfin, Subsonic, or any related self-hosted music projects. Treat it as a fully independent, standalone application to avoid jurisdictional complications.
