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
import { useState } from "react";
import type { AppView } from "./types/types";
import "./styles/layout.css";

export function App() {
  const { serverList, currentServer } = useAuthStore();
  const { sidebarCollapsed, visualizerEnabled } = useSettingsStore();
  const [currentView, setCurrentView] = useState<AppView>("home");

  const hasServers = serverList.length > 0;

  if (!hasServers) {
    return (
      <WebAudioProvider>
        <AuthPage onConnected={() => setCurrentView("home")} />
      </WebAudioProvider>
    );
  }

  function renderView() {
    switch (currentView) {
      case "home":
        return <HomePage onNavigate={setCurrentView} />;
      case "search":
        return <SearchPage />;
      case "settings":
        return <SettingsPage />;
      case "library-albums":
      case "library-artists":
      case "library-songs":
      case "playlists":
        return <LibraryPage />;
      case "now-playing":
        return <NowPlayingPage />;
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
