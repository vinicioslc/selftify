# Selftify

**A cross-platform music player** that plays your music from YouTube Music and local MP3 files. Available for desktop (Linux, macOS, Windows) and Android.

---

## What it does

Selftify lets you:

- **Listen to YouTube Music** without the browser — just paste your browser cookies and play
- **Play your local MP3 files** — scan a folder and your music appears in the library
- **Search across everything** — find songs, albums, and artists from all your sources
- **Watch visualizers** — real-time audio animations (spectrum bars or MilkDrop-style) that dance to the music
- **Dark mode / Light mode** — pick your theme

---

## How it looks

The player has three main areas:

| Area | What's there |
|---|---|
| **Sidebar** (left) | Navigation (Home, Search, Library, Settings) and your connected sources |
| **Main content** (center) | Browse music, view albums and artists, search results |
| **Bottom bar** | Now playing: cover art, track name, play/pause, volume, progress |

Click an album or artist name anywhere to jump to its detail page. Click the album cover in the sidebar to expand it, or collapse it to free up space.

---

## What you need to run it

- **For YouTube Music**: A browser cookies file (Netscape format) exported from youtube.com
- **For local files**: A folder with MP3 files on your computer
- **Desktop**: Download the installer for your OS
- **Android**: Install the APK

---

## Who it's for

People who:
- Use YouTube Music but want a dedicated desktop/mobile app
- Have a collection of MP3s and want a modern player
- Like music visualizers
- Prefer locally-run software with no ads or subscriptions

---

## Tech stack (for developers)

Built with React 19, TypeScript, Vite, Tailwind CSS, and shadcn/ui. Desktop app uses Electron. Android uses Capacitor. Audio plays through the browser's Web Audio API.

See `package.json` or the source code for details.
