import { useAuthStore } from "./stores/auth.store";
import { useSettingsStore } from "./stores/settings.store";
import { useBackendStore } from "./stores/backend.store";
import { useOnlineSearchStore } from "./stores/online-search.store";
import { Sidebar } from "./features/sidebar/sidebar";
import { NavBar } from "./features/navbar/navbar";
import { PlayerBar } from "./features/player/components/playerbar";
import { FullScreenPlayer } from "./features/player/full-screen-player";
import { WebAudioProvider } from "./features/player/web-audio-provider";
import { TopBar } from "./features/topbar/topbar";
import { HomePage } from "./features/home/home-page";
import { SearchPage } from "./features/search/search-page";
import { SettingsModal } from "./features/settings/settings-modal";
import { AuthPage } from "./features/auth/auth-page";
import { LocalPage } from "./features/local/local-page";
import { AutoLocalScan } from "./features/local/auto-local-scan";
import { NowPlayingPage } from "./features/now-playing/now-playing-page";
import { AlbumPage } from "./features/album/album-page";
import { ArtistPage } from "./features/artist/artist-page";
import { PlaylistListPage } from "./features/playlist/playlist-list-page";
import { PlaylistDetailPage } from "./features/playlist/playlist-detail-page";
import { useState, useEffect, useCallback, useRef } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { useIsMobile } from "./hooks/use-media-query";
import type { AppView } from "./types/types";
import type { Album, AlbumArtist, Playlist } from "./types/domain-types";
import { OriginType } from "./types/domain-types";
import "./styles/layout.css";
import { QueueModal } from "./features/player/queue-modal";
import { CookieEditDialog } from "./features/settings/cookie-edit-dialog";
import { Toaster } from "./components/ui/toaster";
import { useGlobalErrorHandler } from "./hooks/use-global-error-handler";
import { useSettingsSync } from "./hooks/use-settings-sync";
import { detectBackend } from "./api/backend-detector";
import { pushViewState, replaceViewState, parseCurrentUrl, safeId } from "./services/url-router";
import type { HistoryState, ParsedRoute } from "./services/url-router";

type SearchState = {
  query: string;
  mode: "local" | "musicbrainz" | "youtube" | "playlist";
};

type NavEntry = {
  view: AppView;
  album: Album | null;
  artist: AlbumArtist | null;
  playlist?: Playlist | null;
  searchState?: SearchState;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:6189";

export function App() {
  useGlobalErrorHandler();
  useSettingsSync();
  const { origins, currentOrigin } = useAuthStore();
  const { sidebarCollapsed, sidebarWidth } = useSettingsStore();

  document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  const [currentView, setCurrentView] = useState<AppView>("home");
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<AlbumArtist | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [searchState, setSearchState] = useState<SearchState>({
    query: "",
    mode: useOnlineSearchStore.getState().enabled ? "musicbrainz" : "local",
  });
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [navFuture, setNavFuture] = useState<NavEntry[]>([]);
  const [showCookieDialog, setShowCookieDialog] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const [queueOpen, setQueueOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();

  function handleOpenSettings(tab?: string) {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }

  const backendConfig = useBackendStore((s) => s.config);
  const setBackendConfig = useBackendStore((s) => s.setConfig);

  // Verify backend connection on startup; clear stale config if unreachable
  useEffect(() => {
    (async () => {
      const { verifyConnection } = await import("./api/backend-detector");
      const saved = useBackendStore.getState().config;
      if (saved) {
        const ok = await verifyConnection(saved);
        if (!ok) {
          console.debug("[app] saved backend config unreachable — clearing");
          useBackendStore.getState().clearConfig();
        }
      } else {
        try {
          const detected = await detectBackend(API_BASE);
          if (detected.type === "selftify" || detected.type === "subsonic") {
            const cfg = { type: detected.type, url: detected.url, user: "admin", password: "admin" };
            const ok = await verifyConnection(cfg);
            if (ok) setBackendConfig(cfg);
          }
        } catch {
          // not reachable — leave backendConfig as null, local controllers will be used
        }
      }

      // Always sync online-search config from backend (if reachable)
      await useOnlineSearchStore.getState().syncFromBackend();
    })();
  }, []);

  function pushNavEntry(view: AppView, album: Album | null, artist: AlbumArtist | null) {
    const entry: NavEntry = { view, album, artist };
    if (view === "search") {
      entry.searchState = { ...searchState };
    }
    setNavHistory(prev => [...prev, entry]);
    setNavFuture([]);
  }

  // Ref for pushState tracking (popstate guard)
  const isHistoryNavRef = useRef(false);

  // Restore full state from a history entry (used by popstate)
  function restoreFromHistory(state: HistoryState) {
    setCurrentView(state.view);
    setSelectedAlbum(state.album ?? null);
    setSelectedArtist(state.artist ?? null);
    setSelectedPlaylist(state.playlist ?? null);
    if (state.searchState) {
      setSearchState(state.searchState as SearchState);
    }
  }

  // Restore from a parsed URL route (used on initial load)
  function restoreFromRoute(route: ParsedRoute) {
    setCurrentView(route.view);
    if (route.searchState) {
      setSearchState(route.searchState as SearchState);
    }
    if (route.albumIdent) {
      const album: Album = {
        id: `album-${safeId(route.albumIdent.albumArtistName)}-${safeId(route.albumIdent.name)}`,
        originId: currentOrigin?.id ?? "",
        originType: currentOrigin?.type ?? OriginType.LOCAL,
        name: route.albumIdent.name,
        albumArtistName: route.albumIdent.albumArtistName,
        imageUrl: null,
      };
      setSelectedAlbum(album);
      setSelectedArtist(null);
    }
    if (route.artistIdent) {
      const artist: AlbumArtist = {
        id: `artist-${safeId(route.artistIdent.name)}`,
        originId: currentOrigin?.id ?? "",
        originType: currentOrigin?.type ?? OriginType.LOCAL,
        name: route.artistIdent.name,
        imageUrl: null,
      };
      setSelectedArtist(artist);
      setSelectedAlbum(null);
    }
    if (route.playlistIdent) {
      const playlist: Playlist = {
        id: route.playlistIdent.id,
        originId: currentOrigin?.id ?? "",
        originType: currentOrigin?.type ?? OriginType.LOCAL,
        name: route.playlistIdent.name,
        imageUrl: null,
      };
      setSelectedPlaylist(playlist);
    }
  }

  function handleNavigateAlbum(album: Album) {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setSelectedAlbum(album);
    setSelectedArtist(null);
    setCurrentView("album-detail");
    pushViewState("album-detail", { album });
  }

  function handleNavigateArtist(artist: AlbumArtist) {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setSelectedArtist(artist);
    setSelectedAlbum(null);
    setCurrentView("artist-detail");
    pushViewState("artist-detail", { artist });
  }

  function handleNavigatePlaylist(playlist: Playlist) {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setSelectedPlaylist(playlist);
    setSelectedAlbum(null);
    setSelectedArtist(null);
    setCurrentView("playlist-detail");
    pushViewState("playlist-detail", { playlist });
  }

  function handleBack() {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setSelectedAlbum(null);
    setSelectedArtist(null);
    setCurrentView("search");
    pushViewState("search");
  }

  function navigateTo(view: AppView) {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setCurrentView(view);
    const params = view === "search" ? { searchState } : {};
    pushViewState(view, params);
  }

  function handleGoBack() {
    if (navHistory.length === 0) return;
    const entry = navHistory[navHistory.length - 1];
    isHistoryNavRef.current = true;
    setNavFuture(prev => [...prev, { view: currentView, album: selectedAlbum, artist: selectedArtist, searchState: { ...searchState } }]);
    setNavHistory(prev => prev.slice(0, -1));
    setCurrentView(entry.view);
    setSelectedAlbum(entry.album);
    setSelectedArtist(entry.artist);
    if (entry.searchState) {
      setSearchState(entry.searchState);
    }
    replaceViewState(entry.view, {
      album: entry.album,
      artist: entry.artist,
      ...(entry.searchState && { searchState: entry.searchState }),
    });
    // Reset flag after React has processed the state update
    setTimeout(() => { isHistoryNavRef.current = false; }, 0);
  }

  function handleGoForward() {
    if (navFuture.length === 0) return;
    const entry = navFuture[navFuture.length - 1];
    isHistoryNavRef.current = true;
    setNavHistory(prev => [...prev, { view: currentView, album: selectedAlbum, artist: selectedArtist, searchState: { ...searchState } }]);
    setNavFuture(prev => prev.slice(0, -1));
    setCurrentView(entry.view);
    setSelectedAlbum(entry.album);
    setSelectedArtist(entry.artist);
    if (entry.searchState) {
      setSearchState(entry.searchState);
    }
    replaceViewState(entry.view, {
      album: entry.album,
      artist: entry.artist,
      ...(entry.searchState && { searchState: entry.searchState }),
    });
    setTimeout(() => { isHistoryNavRef.current = false; }, 0);
  }

  const handleSearchStateChange = useCallback((state: SearchState) => {
    setSearchState(state);
    replaceViewState("search", { searchState: state });
  }, []);

  // --- URL Routing: popstate + initial route restore ---

  useEffect(() => {
    // Check if we already have history state from a previous pushState
    const hs = window.history.state as HistoryState | null;
    if (hs?.view && hs.view !== "home") {
      restoreFromHistory(hs);
      return;
    }

    // Parse URL to restore initial route
    const route = parseCurrentUrl();
    if (route && route.view !== "home") {
      restoreFromRoute(route);
      // Sync the URL with proper history state
      const urlParams: Parameters<typeof replaceViewState>[1] = {};
      if (route.albumIdent) {
        urlParams.album = {
          id: `album-${safeId(route.albumIdent.albumArtistName)}-${safeId(route.albumIdent.name)}`,
          originId: currentOrigin?.id ?? "",
          originType: currentOrigin?.type ?? OriginType.LOCAL,
          name: route.albumIdent.name,
          albumArtistName: route.albumIdent.albumArtistName,
          imageUrl: null,
        };
      }
      if (route.artistIdent) {
        urlParams.artist = {
          id: `artist-${safeId(route.artistIdent.name)}`,
          originId: currentOrigin?.id ?? "",
          originType: currentOrigin?.type ?? OriginType.LOCAL,
          name: route.artistIdent.name,
          imageUrl: null,
        };
      }
      if (route.playlistIdent) {
        urlParams.playlist = {
          id: route.playlistIdent.id,
          originId: currentOrigin?.id ?? "",
          originType: currentOrigin?.type ?? OriginType.LOCAL,
          name: route.playlistIdent.name,
          imageUrl: null,
        };
      }
      if (route.searchState) {
        urlParams.searchState = route.searchState;
      }
      replaceViewState(route.view, urlParams);
    }

    // Popstate listener for browser back/forward
    const onPopState = (e: PopStateEvent) => {
      if (isHistoryNavRef.current) return; // ignore events triggered by our own handleGoBack/Forward
      const st = e.state as HistoryState | null;
      if (st?.view) {
        restoreFromHistory(st);
      } else {
        const r = parseCurrentUrl();
        if (r) restoreFromRoute(r);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function renderView() {
    switch (currentView) {
      case "home":
        return <HomePage onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} onOpenSettings={handleOpenSettings} />;
      case "search":
        return (
          <SearchPage
            initialQuery={searchState.query}
            initialMode={searchState.mode}
            onSearchStateChange={handleSearchStateChange}
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
            onNavigate={navigateTo}
          />
        );
      case "local-albums":
      case "local-artists":
      case "local-songs":
        return (
          <LocalPage
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
          />
        );
      case "playlists":
        return (
          <PlaylistListPage
            onNavigatePlaylist={handleNavigatePlaylist}
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
          />
        );
      case "playlist-detail":
        return selectedPlaylist ? (
          <PlaylistDetailPage
            playlist={selectedPlaylist}
            onBack={() => {
              setSelectedPlaylist(null);
              setCurrentView("playlists");
            }}
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
          />
        ) : (
          <PlaylistListPage
            onNavigatePlaylist={handleNavigatePlaylist}
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
          />
        );
      case "now-playing":
        return (
          <NowPlayingPage
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
            onClose={handleGoBack}
          />
        );
      case "album-detail":
        return selectedAlbum ? (
          <AlbumPage album={selectedAlbum} onBack={handleBack} onNavigateArtist={handleNavigateArtist} />
        ) : (
          <HomePage onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} onOpenSettings={handleOpenSettings} />
        );
      case "artist-detail":
        return selectedArtist ? (
          <ArtistPage
            artist={selectedArtist}
            onBack={handleBack}
            onNavigateAlbum={handleNavigateAlbum}
          />
        ) : (
          <HomePage onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} onOpenSettings={handleOpenSettings} />
        );
      default:
        return <HomePage onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} onOpenSettings={handleOpenSettings} />;
    }
  }

  return (
    <WebAudioProvider>
      <AutoLocalScan />
      <div className="layout">
        <TopBar currentView={currentView} />
        <div className={`main-content ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
          <div className="hidden md:block" style={{ gridArea: "sidebar" }}>
            <Sidebar currentView={currentView} onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} onOpenSettings={handleOpenSettings} />
          </div>
          <div className="main-content-body">
            <NavBar canGoBack={navHistory.length > 0} canGoForward={navFuture.length > 0} onBack={handleGoBack} onForward={handleGoForward}>
              {isMobile && (
                <Button variant="ghost" size="icon" onClick={() => setMobileSidebarOpen(true)} className="h-7 w-7 md:hidden">
                  <Menu className="h-4 w-4" />
                </Button>
              )}
            </NavBar>
            <div className="relative z-10 flex-1 overflow-hidden">
              {renderView()}
            </div>
          </div>
        </div>
        <div className="player-area">
          <PlayerBar currentView={currentView} onNavigate={navigateTo} onGoBack={handleGoBack} onOpenQueue={() => setQueueOpen(true)} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />
        </div>
        <FullScreenPlayer onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />

        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-[400] md:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobileSidebarOpen(false)} />
            <div className="relative h-full w-[280px] animate-in slide-in-from-left duration-200 bg-sidebar border-r border-sidebar-border shadow-2xl">
              <div className="absolute right-2 top-2 z-10">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-sidebar-foreground" onClick={() => setMobileSidebarOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Sidebar currentView={currentView} onNavigate={(v) => { setMobileSidebarOpen(false); navigateTo(v); }} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} onOpenSettings={(t) => { setMobileSidebarOpen(false); handleOpenSettings(t); }} />
            </div>
          </div>
        )}

        <CookieEditDialog
          open={showCookieDialog}
          onOpenChange={setShowCookieDialog}
        />

        <QueueModal
          open={queueOpen}
          onOpenChange={setQueueOpen}
          onNavigateAlbum={handleNavigateAlbum}
          onNavigateArtist={handleNavigateArtist}
        />

        <SettingsModal
          open={settingsOpen}
          onOpenChange={(open) => { setSettingsOpen(open); if (!open) setSettingsTab(undefined); }}
          initialTab={settingsTab}
        />
        <Toaster />
      </div>
    </WebAudioProvider>
  );
}
