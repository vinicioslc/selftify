import { useAuthStore } from "./stores/auth.store";
import { useSettingsStore } from "./stores/settings.store";
import { ServerType } from "./types/domain-types";
import { Sidebar } from "./features/sidebar/sidebar";
import { PlayerBar } from "./features/player/player-bar";
import { FullScreenPlayer } from "./features/player/full-screen-player";
import { VisualizerContainer } from "./features/visualizer/visualizer-container";
import { WebAudioProvider } from "./features/player/web-audio-provider";
import { HomePage } from "./features/home/home-page";
import { SearchPage } from "./features/search/search-page";
import { SettingsPage } from "./features/settings/settings-page";
import { AuthPage } from "./features/auth/auth-page";
import { LibraryPage } from "./features/library/library-page";
import { useState } from "react";

type View = "home" | "search" | "settings" | "library" | "auth";

export function App() {
  const { serverList, currentServer } = useAuthStore();
  const { sidebarCollapsed, visualizerEnabled } = useSettingsStore();
  const [currentView, setCurrentView] = useState<View>("home");

  const hasServers = serverList.length > 0;
  const needsAuth = !currentServer;
  const isLocal = currentServer?.type === ServerType.LOCAL;

  // Show auth page if no servers are configured
  if (!hasServers) {
    return (
      <WebAudioProvider>
        <AuthPage />
      </WebAudioProvider>
    );
  }

  function renderView() {
    switch (currentView) {
      case "home":
        return <HomePage />;
      case "search":
        return <SearchPage />;
      case "settings":
        return <SettingsPage />;
      case "library":
        return <LibraryPage />;
      case "auth":
        return <AuthPage />;
      default:
        return <HomePage />;
    }
  }

  return (
    <WebAudioProvider>
      <div className="flex h-full flex-col">
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className={sidebarCollapsed ? "w-16" : "w-64"}>
            <Sidebar />
          </div>

          {/* Main content area with visualizer */}
          <div className="relative flex flex-1 flex-col overflow-hidden">
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

        {/* Player bar */}
        <div
          className="border-t"
          style={{ height: "var(--player-bar-height)", minHeight: "var(--player-bar-height)" }}
        >
          <PlayerBar />
        </div>
      </div>

      {/* Full screen player overlay */}
      <FullScreenPlayer />
    </WebAudioProvider>
  );
}
