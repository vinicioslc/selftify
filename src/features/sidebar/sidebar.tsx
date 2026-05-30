import { useEffect, useState } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { useLocalLibraryStore } from "../../stores/local-library.store";
import { usePlayerStore } from "../../stores/player.store";
import { OriginType } from "../../types/domain-types";
import type { AppView } from "../../types/types";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { Badge } from "../../components/ui/badge";
import { Avatar } from "../../components/ui/avatar";
import { ScanIndicator } from "../../components/ui/scan-indicator";
import { ResizeHandle } from "../../components/ui/resize-handle";
import { ORIGIN_TYPE_LABEL } from "../../lib/status-labels";
import {
  Home,
  Search,
  Library,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Music,
  Tv2,
  Youtube,
  FolderOpen,
  Disc3,
} from "lucide-react";

type SidebarProps = {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
};

const navItems: { id: AppView; label: string; icon: any }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "library-songs", label: "Library", icon: Library },
  { id: "settings", label: "Settings", icon: Settings },
];

function originIcon(type: OriginType | string): any {
  switch (type) {
    case OriginType.JELLYFIN:
      return Tv2;
    case OriginType.NAVIDROME:
    case OriginType.SUBISONIC:
      return Music;
    case OriginType.YOUTUBE_MUSIC:
      return Youtube;
    case OriginType.LOCAL:
      return FolderOpen;
    default:
      return Music;
  }
}

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  const { origins, currentOrigin, setCurrentOrigin } = useAuthStore();
  const { sidebarCollapsed, sidebarWidth, toggleSidebar, setSidebarWidth } = useSettingsStore();
  const { scanStatus, scanningOriginId } = useLocalLibraryStore();
  const { currentTrack } = usePlayerStore();
  const [albumArtCollapsed, setAlbumArtCollapsed] = useState(false);
  const ORIGINS_STORAGE_KEY = "ytmusic:sidebar:origins-expanded";
  const [originsExpanded, setOriginsExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(ORIGINS_STORAGE_KEY);
      return stored !== null ? JSON.parse(stored) : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(ORIGINS_STORAGE_KEY, JSON.stringify(originsExpanded));
    } catch {}
  }, [originsExpanded]);

  const isScanning = scanStatus === "scanning" || scanStatus === "paused";

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
            variant={currentView === item.id ? "default" : "ghost"}
            size="icon"
            onClick={() => onNavigate(item.id)}
            className={currentView === item.id ? "" : "text-sidebar-foreground hover:text-foreground"}
          >
            <item.icon className="h-5 w-5" />
          </Button>
        ))}
        <Separator className="my-1 bg-sidebar-border" />
        {origins.map((o) => {
          const Icon = originIcon(o.type);
          return (
            <Button
              key={o.id}
              variant="ghost"
              size="icon"
              className={`relative ${currentOrigin?.id === o.id ? "text-primary" : "text-sidebar-foreground hover:text-foreground"}`}
              onClick={() => setCurrentOrigin(o)}
            >
              <Icon className="h-4 w-4" />
              {isScanning && scanningOriginId === o.id && (
                <ScanIndicator className="absolute -bottom-0.5 -right-0.5" />
              )}
            </Button>
          );
        })}
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
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant={currentView === item.id ? "secondary" : "ghost"}
              className={`w-full px-3 text-sm font-normal ${
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
          ))}
        </nav>

        <Separator className="my-3 bg-sidebar-border" />

        <div className="space-y-1">
          <button
            type="button"
            className="flex w-full items-center gap-1 px-3 py-1 text-xs font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
            onClick={() => setOriginsExpanded(!originsExpanded)}
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform duration-200 ${
                originsExpanded ? "rotate-90" : ""
              }`}
            />
            ORIGINS
          </button>
          {originsExpanded && origins.map((o) => {
            const Icon = originIcon(o.type);
            return (
              <Button
                key={o.id}
                variant="ghost"
                className={`w-full px-3 text-sm font-normal ${
                  currentOrigin?.id === o.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:text-foreground"
                }`}
                onClick={() => setCurrentOrigin(o)}
              >
                <span className="flex w-full items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0" />
                  {isScanning && scanningOriginId === o.id && (
                    <ScanIndicator />
                  )}
                  <span className="flex-1 truncate text-left">{o.name}</span>
                  <Badge variant="outline" className="border-sidebar-border text-[10px] text-sidebar-foreground/60">
                    {ORIGIN_TYPE_LABEL[o.type] ?? o.type}
                  </Badge>
                </span>
              </Button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Album art at bottom - Feishin style */}
      {currentTrack && (
        <>
          <Separator className="bg-sidebar-border" />
          <div className="group relative p-3">
            {!albumArtCollapsed && (
              <div
                className="relative w-full cursor-pointer overflow-hidden"
                style={{ aspectRatio: "1/1" }}
                onClick={() => onNavigate("now-playing")}
              >
                <Avatar
                  src={currentTrack.imageUrl}
                  alt={currentTrack.name}
                  fallback={currentTrack.name.charAt(0)}
                  className="h-full w-full rounded-none"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                  <Disc3 className="h-8 w-8 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 h-6 w-6 bg-black/40 text-white opacity-0 transition-opacity hover:bg-black/60 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAlbumArtCollapsed(true);
                  }}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            {albumArtCollapsed && (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-sidebar-foreground">
                    {currentTrack.name}
                  </p>
                  <p className="truncate text-[11px] text-sidebar-foreground/50">
                    {currentTrack.artistName}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-sidebar-foreground/50 hover:text-foreground"
                  onClick={() => setAlbumArtCollapsed(false)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
