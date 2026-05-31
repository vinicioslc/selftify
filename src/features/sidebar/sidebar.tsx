import { useSettingsStore } from "../../stores/settings.store";
import { usePlayerStore } from "../../stores/player.store";
import { useAuthStore } from "../../stores/auth.store";
import type { AppView } from "../../types/types";
import type { Album, AlbumArtist } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { Avatar } from "../../components/ui/avatar";
import { ResizeHandle } from "../../components/ui/resize-handle";
import { VisualizerContainer } from "../visualizer/visualizer-container";
import {
  Home,
  Search,
  Library,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Disc3,
  Music2,
  FolderOpen,
  Globe,
} from "lucide-react";
import { useState } from "react";

type SidebarProps = {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

const navItems: { id: AppView; label: string; icon: any }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "local-songs", label: "Local", icon: Library },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({ currentView, onNavigate, onNavigateAlbum, onNavigateArtist }: SidebarProps) {
  const { sidebarCollapsed, sidebarWidth, toggleSidebar, setSidebarWidth, sidebarAlbumCollapsed, setSidebarAlbumCollapsed, sidebarShowVisualizer, setSidebarShowVisualizer, visualizerType } = useSettingsStore();
  const { currentTrack } = usePlayerStore();
  const { currentOrigin } = useAuthStore();
  const [searchExpanded, setSearchExpanded] = useState(true);

  function handleResize(width: number) {
    setSidebarWidth(width);
  }

  function handleSearchLocal() {
    onNavigate("search");
  }

  function handleSearchOnline() {
    onNavigate("search");
  }

  if (sidebarCollapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar p-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="text-sidebar-foreground hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </Button>
        {navItems.map((item) => (
          <Button
            key={item.id}
            variant={currentView === item.id ? "default" : "ghost"}
            size="icon"
            onClick={() => onNavigate(item.id)}
            className={currentView === item.id ? "" : "text-sidebar-foreground hover:text-foreground"}
          >
            <item.icon className="h-5 w-5" />
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      <ResizeHandle onResize={handleResize} minWidth={220} />

      <div className="flex items-center px-3 py-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-7 w-7 text-sidebar-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <Separator className="bg-sidebar-border" />

      <ScrollArea className="flex-1 py-2">
        <nav className="space-y-1">
          {navItems.map((item) => {
            if (item.id === "search") {
              return (
                <div key={item.id}>
                  <button
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-normal transition-colors ${
                      currentView === item.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                    onClick={() => setSearchExpanded(!searchExpanded)}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {searchExpanded ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                  {searchExpanded && (
                    <div className="ml-2 mt-0.5 space-y-0.5 pl-2">
                      <button
                        title="Search local files"
                        className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-xs font-normal text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        onClick={handleSearchLocal}
                      >
                        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Local Files</span>
                      </button>
                      {currentOrigin?.enableOnlineSearch && (
                        <button
                          title="Search with MusicBrainz + YouTube"
                          className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-xs font-normal text-sidebar-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          onClick={handleSearchOnline}
                        >
                          <Globe className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">Online Search</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <Button
                key={item.id}
                variant={currentView === item.id ? "secondary" : "ghost"}
                className={`w-full justify-start px-3 text-sm font-normal ${
                  currentView === item.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:text-foreground"
                }`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="flex w-full items-center gap-3">
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </span>
              </Button>
            );
          })}
        </nav>

      </ScrollArea>

      {/* Album art / Visualizer at bottom (only when expanded) */}
      {currentTrack && !sidebarAlbumCollapsed && (
        <>
          <Separator className="bg-sidebar-border" />
          <div className="group relative p-3">
            <div className="absolute right-1 top-1 z-10 flex gap-1">
              {visualizerType !== "none" && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-6 w-6 ${sidebarShowVisualizer ? "bg-black/40 text-white" : "bg-black/60 text-white"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSidebarShowVisualizer(!sidebarShowVisualizer);
                    }}
                  >
                    {sidebarShowVisualizer ? <Disc3 className="h-3.5 w-3.5" /> : <span className="text-xs">🎨</span>}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 bg-black/40 text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate("settings-visualizer");
                    }}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 bg-black/40 text-white opacity-0 transition-opacity hover:bg-black/60 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  setSidebarAlbumCollapsed(true);
                }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>

            {sidebarShowVisualizer && visualizerType !== "none" ? (
              <div
                className="relative w-full overflow-hidden"
                style={{ aspectRatio: "1/1" }}
              >
                <VisualizerContainer force />
              </div>
            ) : (
              <div
                className="relative w-full overflow-hidden"
                style={{ aspectRatio: "1/1" }}
              >
                <Avatar
                  src={currentTrack.imageUrl}
                  alt={currentTrack.name}
                  fallback={currentTrack.name.charAt(0)}
                  className="h-full w-full rounded-none"
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
