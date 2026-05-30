import { useAuthStore } from "./stores/auth.store";
import { useSettingsStore } from "./stores/settings.store";
import { Sidebar } from "./features/sidebar/sidebar";
import { PlayerBar } from "./features/player/components/playerbar";
import { FullScreenPlayer } from "./features/player/full-screen-player";
import { VisualizerContainer } from "./features/visualizer/visualizer-container";
import { WebAudioProvider } from "./features/player/web-audio-provider";
import { HomePage } from "./features/home/home-page";
import { SearchPage } from "./features/search/search-page";
import { SettingsPage } from "./features/settings/settings-page";
import { AuthPage } from "./features/auth/auth-page";
import { LibraryPage } from "./features/library/library-page";
import { NowPlayingPage } from "./features/now-playing/now-playing-page";
import { AlbumPage } from "./features/album/album-page";
import { ArtistPage } from "./features/artist/artist-page";
import { useState } from "react";
import type { AppView } from "./types/types";
import type { Album, AlbumArtist } from "./types/domain-types";
import "./styles/layout.css";

export function App() {
  const { origins, currentOrigin } = useAuthStore();
  const { sidebarCollapsed, sidebarWidth, visualizerEnabled } = useSettingsStore();

  document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  const [currentView, setCurrentView] = useState<AppView>("home");
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<AlbumArtist | null>(null);

  const hasServers = origins.length > 0;

  if (!hasServers) {
    return (
      <WebAudioProvider>
        <AuthPage onConnected={() => setCurrentView("home")} />
      </WebAudioProvider>
    );
  }

  function handleNavigateAlbum(album: Album) {
    setSelectedAlbum(album);
    setSelectedArtist(null);
    setCurrentView("album-detail");
  }

  function handleNavigateArtist(artist: AlbumArtist) {
    setSelectedArtist(artist);
    setSelectedAlbum(null);
    setCurrentView("artist-detail");
  }

  function handleBack() {
    setSelectedAlbum(null);
    setSelectedArtist(null);
    setCurrentView("search");
  }

  function handleNavigateFromArtist(albumName: string, artistName: string) {
    const album: Album = {
      id: `local-album-${artistName.toLowerCase().replace(/\s+/g, "-")}-${albumName.toLowerCase().replace(/\s+/g, "-")}`,
      originId: currentOrigin?.id || "",
      originType: currentOrigin?.type || "local" as any,
      name: albumName,
      albumArtistName: artistName,
      imageUrl: null,
    };
    setSelectedAlbum(album);
    setSelectedArtist(null);
    setCurrentView("album-detail");
  }

  function renderView() {
    switch (currentView) {
      case "home":
        return <HomePage onNavigate={setCurrentView} />;
      case "search":
        return (
          <SearchPage
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
          />
        );
      case "settings":
        return <SettingsPage />;
      case "library-albums":
      case "library-artists":
      case "library-songs":
      case "playlists":
        return (
          <LibraryPage
            onNavigateAlbum={handleNavigateAlbum}
            onNavigateArtist={handleNavigateArtist}
          />
        );
      case "now-playing":
        return <NowPlayingPage />;
      case "album-detail":
        return selectedAlbum ? (
          <AlbumPage album={selectedAlbum} onBack={handleBack} />
        ) : (
          <HomePage onNavigate={setCurrentView} />
        );
      case "artist-detail":
        return selectedArtist ? (
          <ArtistPage
            artist={selectedArtist}
            onBack={handleBack}
            onNavigateAlbum={handleNavigateFromArtist}
          />
        ) : (
          <HomePage onNavigate={setCurrentView} />
        );
      default:
        return <HomePage onNavigate={setCurrentView} />;
    }
  }

  return (
    <WebAudioProvider>
      <div className="layout">
        <div className={`main-content ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
          <div style={{ gridArea: "sidebar" }}>
            <Sidebar currentView={currentView} onNavigate={setCurrentView} />
          </div>
          <div className="main-content-body">
            {visualizerEnabled && (
              <div className="pointer-events-none absolute inset-0 z-0 opacity-20">
                <VisualizerContainer />
              </div>
            )}
            <div className="relative z-10 flex-1 overflow-hidden">
              {renderView()}
            </div>
          </div>
        </div>
        <div className="player-area">
          <PlayerBar onNavigate={setCurrentView} />
        </div>
      </div>
      <FullScreenPlayer />
    </WebAudioProvider>
  );
}
