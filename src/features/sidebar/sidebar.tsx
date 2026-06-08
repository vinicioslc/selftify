import { useSettingsStore } from "../../stores/settings.store";
import { usePlayerStore } from "../../stores/player.store";
import { useAuthStore } from "../../stores/auth.store";
import type { AppView } from "../../types/types";
import type { Album, AlbumArtist } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { CoverImage } from "../../components/ui/art-image";
import { ResizeHandle } from "../../components/ui/resize-handle";
import { VisualizerContainer } from "../visualizer/visualizer-container";
import { useDownloadStore } from "../../stores/download.store";
import {
  Home,
  Search,
  Library,
  Settings,
  ListMusic,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Disc3,
  Download,
} from "lucide-react";
import { Badge } from "../../components/ui/badge";

type SidebarProps = {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

const navItems: { id: string; label: string; icon: any }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "playlists", label: "Playlists", icon: ListMusic },
  { id: "local-songs", label: "Local", icon: Library },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "downloads", label: "Downloads", icon: Download },
];

export function Sidebar({ currentView, onNavigate, onNavigateAlbum, onNavigateArtist }: SidebarProps) {
  const { sidebarCollapsed, sidebarWidth, toggleSidebar, setSidebarWidth, sidebarAlbumCollapsed, setSidebarAlbumCollapsed, sidebarShowVisualizer, setSidebarShowVisualizer, visualizerType } = useSettingsStore();
  const setPanelOpen = useDownloadStore((s) => s.setPanelOpen);
  const pendingCount = useDownloadStore((s) => s.tasks.filter(t => t.status === "pending" || t.status === "searching" || t.status === "downloading-audio" || t.status === "getting-cover" || t.status === "processing-cover" || t.status === "embedding-cover").length);

  function handleNavClick(itemId: string) {
    if (itemId === "downloads") {
      setPanelOpen(true);
    } else {
      onNavigate(itemId as AppView);
    }
  }

  const { currentTrack } = usePlayerStore();
  const { currentOrigin } = useAuthStore();

  function handleResize(width: number) {
    setSidebarWidth(width);
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
                variant={item.id === "downloads" ? "ghost" : currentView === item.id ? "default" : "ghost"}
            size="icon"
            onClick={() => handleNavClick(item.id)}
            className={currentView === item.id ? "" : "text-sidebar-foreground hover:text-foreground"}
            title={item.label}
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
            const isDownloads = item.id === "downloads";
            const isActive = !isDownloads && currentView === item.id;
            return (
              <Button
                key={item.id}
                variant={isActive ? "secondary" : "ghost"}
                className={`w-full justify-start px-3 text-sm font-normal ${
                  currentView === item.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:text-foreground"
                }`}
                onClick={() => handleNavClick(item.id)}
              >
                <span className="flex w-full items-center gap-3">
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                  {isDownloads && pendingCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="ml-auto h-5 min-w-[20px] rounded-full px-1.5 text-[10px]"
                    >
                      {pendingCount}
                    </Badge>
                  )}
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
                <CoverImage
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
