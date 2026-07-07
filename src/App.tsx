import { useAuthStore } from "./stores/auth.store";
import { useSettingsStore } from "./stores/settings.store";
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
import { useState, useEffect, useCallback } from "react";
import { Menu, AlertTriangle, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { useIsMobile } from "./hooks/use-media-query";
import type { AppView } from "./types/types";
import type { Album, AlbumArtist, Playlist } from "./types/domain-types";
import { OriginType } from "./types/domain-types";
import "./styles/layout.css";
import { QueueModal } from "./features/player/queue-modal";

import { DownloadQueuePanel } from "./features/download/download-queue-panel";
import { getPlatformService } from "./services/platform/factory";
import { CookieEditDialog } from "./features/settings/cookie-edit-dialog";
import { Toaster } from "./components/ui/toaster";
import { useGlobalErrorHandler } from "./hooks/use-global-error-handler";

type SearchState = {
  query: string;
  mode: "local" | "musicbrainz" | "youtube";
};

type NavEntry = {
  view: AppView;
  album: Album | null;
  artist: AlbumArtist | null;
  playlist?: Playlist | null;
  searchState?: SearchState;
};

export function App() {
  useGlobalErrorHandler();
  const { origins, currentOrigin } = useAuthStore();
  const { sidebarCollapsed, sidebarWidth } = useSettingsStore();

  document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  const [currentView, setCurrentView] = useState<AppView>("home");
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<AlbumArtist | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [searchState, setSearchState] = useState<SearchState>({
    query: "",
    mode: currentOrigin?.enableOnlineSearch ? "musicbrainz" : "local",
  });
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [navFuture, setNavFuture] = useState<NavEntry[]>([]);
  const [showCookieToast, setShowCookieToast] = useState(false);
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

  // Listen for yt-dlp cookie invalid warnings from Electron main process
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    getPlatformService().then((svc) => {
      cleanup = svc.onCookiesInvalid(() => {
        setShowCookieToast(true);
      });
    });
    return () => cleanup?.();
  }, []);

  const hasServers = origins.length > 0;

  function pushNavEntry(view: AppView, album: Album | null, artist: AlbumArtist | null) {
    const entry: NavEntry = { view, album, artist };
    if (view === "search") {
      entry.searchState = { ...searchState };
    }
    setNavHistory(prev => [...prev, entry]);
    setNavFuture([]);
  }

  function handleNavigateAlbum(album: Album) {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setSelectedAlbum(album);
    setSelectedArtist(null);
    setCurrentView("album-detail");
  }

  function handleNavigateArtist(artist: AlbumArtist) {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setSelectedArtist(artist);
    setSelectedAlbum(null);
    setCurrentView("artist-detail");
  }

  function handleNavigatePlaylist(playlist: Playlist) {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setSelectedPlaylist(playlist);
    setSelectedAlbum(null);
    setSelectedArtist(null);
    setCurrentView("playlist-detail");
  }

  function handleBack() {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setSelectedAlbum(null);
    setSelectedArtist(null);
    setCurrentView("search");
  }

  function navigateTo(view: AppView) {
    pushNavEntry(currentView, selectedAlbum, selectedArtist);
    setCurrentView(view);
  }

  function handleGoBack() {
    if (navHistory.length === 0) return;
    const entry = navHistory[navHistory.length - 1];
    setNavFuture(prev => [...prev, { view: currentView, album: selectedAlbum, artist: selectedArtist, searchState: { ...searchState } }]);
    setNavHistory(prev => prev.slice(0, -1));
    setCurrentView(entry.view);
    setSelectedAlbum(entry.album);
    setSelectedArtist(entry.artist);
    if (entry.searchState) {
      setSearchState(entry.searchState);
    }
  }

  function handleGoForward() {
    if (navFuture.length === 0) return;
    const entry = navFuture[navFuture.length - 1];
    setNavHistory(prev => [...prev, { view: currentView, album: selectedAlbum, artist: selectedArtist, searchState: { ...searchState } }]);
    setNavFuture(prev => prev.slice(0, -1));
    setCurrentView(entry.view);
    setSelectedAlbum(entry.album);
    setSelectedArtist(entry.artist);
    if (entry.searchState) {
      setSearchState(entry.searchState);
    }
  }

  const handleSearchStateChange = useCallback((state: SearchState) => {
    setSearchState(state);
    syncUrlWithSearch(state);
  }, []);

  function syncUrlWithSearch(state: SearchState) {
    const params = new URLSearchParams();
    if (state.query) params.set("q", state.query);
    if (state.mode) params.set("mode", state.mode);
    const search = params.toString();
    const url = search ? `?${search}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const mode = params.get("mode");
    if (q || mode) {
      setSearchState({
        query: q || "",
        mode: (mode === "local" || mode === "musicbrainz" || mode === "youtube") ? mode : (currentOrigin?.enableOnlineSearch ? "musicbrainz" : "local"),
      });
    }
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
      {!hasServers ? (
        <AuthPage onConnected={() => setCurrentView("home")} />
      ) : (
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
        <DownloadQueuePanel />

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

        {showCookieToast && (
          <button
            onClick={() => {
              setShowCookieToast(false);
              setShowCookieDialog(true);
            }}
            className="fixed bottom-[calc(var(--player-bar-height)+8px)] left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-600 bg-amber-950/90 px-4 py-2 text-sm text-amber-200 shadow-lg backdrop-blur transition-colors hover:bg-amber-900/90"
          >
            <AlertTriangle className="h-4 w-4" />
            <span>YouTube cookies expired — click to update</span>
          </button>
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
      )}
    </WebAudioProvider>
  );
}
