import type { AppView } from "../types/types";
import type { Album, AlbumArtist, Playlist } from "../types/domain-types";

// --- Helpers ---

/** URL-safe string for entity IDs (ASCII only) */
export function safeId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 100);
}

/** Encode a name for use in a URL path segment (preserves Unicode) */
export function encodePathSegment(text: string): string {
  return encodeURIComponent(text);
}

/** Decode a URL path segment back to the original name */
export function decodePathSegment(encoded: string): string {
  try {
    return decodeURIComponent(encoded.replace(/\+/g, " "));
  } catch {
    return encoded;
  }
}

// --- History state (stashed in pushState / popstate) ---

export interface HistoryState {
  view: AppView;
  album?: Album;
  artist?: AlbumArtist;
  playlist?: Playlist;
  searchState?: { query: string; mode: string };
}

// --- Parsed route from URL (for direct-initial-load restore) ---

export interface ParsedRoute {
  view: AppView;
  searchState?: { query: string; mode: string };
  albumIdent?: { albumArtistName: string; name: string };
  artistIdent?: { name: string };
  playlistIdent?: { id: string; name: string };
}

// --- Parse window.location into a ParsedRoute ---

export function parseCurrentUrl(): ParsedRoute | null {
  const { pathname } = window.location;
  const searchParams = new URLSearchParams(window.location.search);
  const path = pathname === "/" ? "/" : pathname.replace(/\/$/, "");

  if (path === "/") return { view: "home" };

  if (path === "/search") {
    const rawMode = searchParams.get("mode");
    const mode: "local" | "musicbrainz" | "youtube" =
      rawMode === "local" || rawMode === "musicbrainz" || rawMode === "youtube"
        ? rawMode
        : "local";
    return {
      view: "search",
      searchState: {
        query: searchParams.get("q") || "",
        mode,
      },
    };
  }

  if (path === "/library/albums") return { view: "local-albums" };
  if (path === "/library/artists") return { view: "local-artists" };
  if (path === "/library/songs") return { view: "local-songs" };
  if (path === "/playlists") return { view: "playlists" };

  const playlistMatch = path.match(/^\/playlist\/(.+)$/);
  if (playlistMatch) {
    const id = decodeURIComponent(playlistMatch[1]);
    const name = searchParams.get("name") || id;
    return { view: "playlist-detail", playlistIdent: { id, name } };
  }

  const albumMatch = path.match(/^\/album\/([^/]+)\/([^/]+)$/);
  if (albumMatch) {
    return {
      view: "album-detail",
      albumIdent: {
        albumArtistName: decodePathSegment(albumMatch[1]),
        name: decodePathSegment(albumMatch[2]),
      },
    };
  }

  const artistMatch = path.match(/^\/artist\/(.+)$/);
  if (artistMatch) {
    return { view: "artist-detail", artistIdent: { name: decodePathSegment(artistMatch[1]) } };
  }

  if (path === "/now-playing") return { view: "now-playing" };

  return null;
}

// --- Build a URL string from view + entity data ---

interface BuildUrlParams {
  album?: Album | null;
  artist?: AlbumArtist | null;
  playlist?: Playlist | null;
  searchState?: { query?: string; mode?: string };
}

export function buildUrl(view: AppView, params?: BuildUrlParams): string {
  switch (view) {
    case "home":
      return "/";
    case "search": {
      const q = params?.searchState?.query;
      const mode = params?.searchState?.mode;
      if (q || mode) {
        const sp = new URLSearchParams();
        if (q) sp.set("q", q);
        if (mode && (mode === "local" || mode === "musicbrainz" || mode === "youtube")) sp.set("mode", mode);
        return `/search?${sp.toString()}`;
      }
      return "/search";
    }
    case "local-albums":
      return "/library/albums";
    case "local-artists":
      return "/library/artists";
    case "local-songs":
      return "/library/songs";
    case "playlists":
      return "/playlists";
    case "playlist-detail": {
      const p = params?.playlist;
      return p ? `/playlist/${encodeURIComponent(p.id)}?name=${encodeURIComponent(p.name)}` : "/playlists";
    }
    case "album-detail": {
      const a = params?.album;
      return a ? `/album/${encodePathSegment(a.albumArtistName)}/${encodePathSegment(a.name)}` : "/";
    }
    case "artist-detail": {
      const a = params?.artist;
      return a ? `/artist/${encodePathSegment(a.name)}` : "/";
    }
    case "now-playing":
      return "/now-playing";
    default:
      return "/";
  }
}

// --- Push a new history entry (used on navigation) ---

export function pushViewState(
  view: AppView,
  params?: {
    album?: Album | null;
    artist?: AlbumArtist | null;
    playlist?: Playlist | null;
    searchState?: { query?: string; mode?: string };
  },
) {
  const url = buildUrl(view, params);
  const state: HistoryState = {
    view,
    ...(params?.album ? { album: params.album } : {}),
    ...(params?.artist ? { artist: params.artist } : {}),
    ...(params?.playlist ? { playlist: params.playlist } : {}),
    ...(params?.searchState?.query !== undefined ? { searchState: params.searchState as { query: string; mode: string } } : {}),
  };
  window.history.pushState(state, "", url);
}

// --- Replace current history entry (used for search query changes) ---

export function replaceViewState(
  view: AppView,
  params?: {
    album?: Album | null;
    artist?: AlbumArtist | null;
    playlist?: Playlist | null;
    searchState?: { query?: string; mode?: string };
  },
) {
  const url = buildUrl(view, params);
  const state: HistoryState = {
    view,
    ...(params?.album ? { album: params.album } : {}),
    ...(params?.artist ? { artist: params.artist } : {}),
    ...(params?.playlist ? { playlist: params.playlist } : {}),
    ...(params?.searchState?.query !== undefined ? { searchState: params.searchState as { query: string; mode: string } } : {}),
  };
  window.history.replaceState(state, "", url);
}
