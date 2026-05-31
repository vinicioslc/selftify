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
import { SettingsPage } from "./features/settings/settings-page";
import { AuthPage } from "./features/auth/auth-page";
import { LocalPage } from "./features/local/local-page";
import { NowPlayingPage } from "./features/now-playing/now-playing-page";
import { AlbumPage } from "./features/album/album-page";
import { ArtistPage } from "./features/artist/artist-page";
import { useState, useEffect, useCallback } from "react";
import type { AppView } from "./types/types";
import type { Album, AlbumArtist } from "./types/domain-types";
import { OriginType } from "./types/domain-types";
import "./styles/layout.css";

type SearchState = {
  query: string;
  mode: "local" | "musicbrainz" | "youtube-pure";
};

type NavEntry = {
  view: AppView;
  album: Album | null;
  artist: AlbumArtist | null;
  searchState?: SearchState;
};

export function App() {
  const { origins, currentOrigin } = useAuthStore();
  const { sidebarCollapsed, sidebarWidth } = useSettingsStore();

  document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  const [currentView, setCurrentView] = useState<AppView>("home");
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<AlbumArtist | null>(null);
  const [searchState, setSearchState] = useState<SearchState>({
    query: "",
    mode: currentOrigin?.enableOnlineSearch ? "musicbrainz" : "local",
  });
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [navFuture, setNavFuture] = useState<NavEntry[]>([]);

  const hasServers = origins.length > 0;

  if (!hasServers) {
    return (
      <WebAudioProvider>
        <AuthPage onConnected={() => setCurrentView("home")} />
      </WebAudioProvider>
    );
  }

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
        mode: (mode === "local" || mode === "musicbrainz" || mode === "youtube-pure") ? mode : (currentOrigin?.enableOnlineSearch ? "musicbrainz" : "local"),
      });
    }
  }, []);

  function renderView() {
    switch (currentView) {
      case "home":
        return <HomePage onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />;
      case "search":
        return (
          <SearchPage
            initialQuery={searchState.query}
            initialMode={searchState.mode}
            onSearchStateChange={handleSearchStateChange}
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
          />
        );
      case "settings":
        return <SettingsPage />;
      case "settings-visualizer":
        return <SettingsPage initialTab="visualizer" />;
      case "local-albums":
      case "local-artists":
      case "local-songs":
      case "playlists":
        return (
          <LocalPage
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
          />
        );
      case "now-playing":
        return <NowPlayingPage onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />;
      case "album-detail":
        return selectedAlbum ? (
          <AlbumPage album={selectedAlbum} onBack={handleBack} onNavigateArtist={handleNavigateArtist} />
        ) : (
          <HomePage onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />
        );
      case "artist-detail":
        return selectedArtist ? (
          <ArtistPage
            artist={selectedArtist}
            onBack={handleBack}
            onNavigateAlbum={handleNavigateAlbum}
          />
        ) : (
          <HomePage onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />
        );
      default:
        return <HomePage onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />;
    }
  }

  return (
    <WebAudioProvider>
      <div className="layout">
        <TopBar />
        <div className={`main-content ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
          <div style={{ gridArea: "sidebar" }}>
            <Sidebar currentView={currentView} onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />
          </div>
          <div className="main-content-body">
            <NavBar canGoBack={navHistory.length > 0} canGoForward={navFuture.length > 0} onBack={handleGoBack} onForward={handleGoForward} />
            <div className="relative z-10 flex-1 overflow-hidden">
              {renderView()}
            </div>
          </div>
        </div>
        <div className="player-area">
          <PlayerBar onNavigate={navigateTo} onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />
        </div>
      </div>
      <FullScreenPlayer onNavigateAlbum={handleNavigateAlbum} onNavigateArtist={handleNavigateArtist} />
    </WebAudioProvider>
  );
}
