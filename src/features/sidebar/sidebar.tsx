import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { ServerType } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { Badge } from "../../components/ui/badge";
import {
  Home,
  Search,
  Library,
  Disc3,
  ListMusic,
  Settings,
  ChevronLeft,
  ChevronRight,
  Music,
  Tv2,
  Youtube,
  FolderOpen,
} from "lucide-react";

const navItems = [
  { id: "home", label: "Home", icon: Home, route: "/" },
  { id: "search", label: "Search", icon: Search, route: "/search" },
  { id: "library", label: "Library", icon: Library, route: "/library" },
  { id: "albums", label: "Albums", icon: Disc3, route: "/library/albums" },
  { id: "artists", label: "Artists", icon: Music, route: "/library/artists" },
  { id: "playlists", label: "Playlists", icon: ListMusic, route: "/playlists" },
  { id: "settings", label: "Settings", icon: Settings, route: "/settings" },
];

function serverIcon(type: ServerType | string) {
  switch (type) {
    case ServerType.NAVIDROME:
      return Music;
    case ServerType.JELLYFIN:
      return Tv2;
    case ServerType.YOUTUBE_MUSIC:
      return Youtube;
    case "local":
    case ServerType.LOCAL:
      return FolderOpen;
    default:
      return Music;
  }
}

export function Sidebar() {
  const { serverList, currentServer, setCurrentServer } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useSettingsStore();

  if (sidebarCollapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-2 border-r bg-sidebar p-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {navItems.map((item) => (
          <Button key={item.id} variant="ghost" size="icon" className="text-sidebar-foreground">
            <item.icon className="h-5 w-5" />
          </Button>
        ))}
        <Separator className="my-2" />
        {serverList.map((server) => {
          const Icon = serverIcon(server.type);
          return (
            <Button
              key={server.id}
              variant="ghost"
              size="icon"
              className={currentServer?.id === server.id ? "text-primary" : ""}
              onClick={() => setCurrentServer(server)}
            >
              <Icon className="h-4 w-4" />
            </Button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-r bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-bold tracking-tight">YT Music</h1>
        <Button variant="ghost" size="icon" onClick={toggleSidebar}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      {/* Navigation */}
      <ScrollArea className="flex-1 px-2 py-2">
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className="w-full justify-start gap-3 px-3 text-sm font-normal text-sidebar-foreground"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Button>
          ))}
        </nav>

        <Separator className="my-3" />

        {/* Servers */}
        <div className="space-y-1">
          <p className="px-3 text-xs font-medium text-sidebar-foreground/60">SERVERS</p>
          {serverList.map((server) => {
            const Icon = serverIcon(server.type);
            return (
              <Button
                key={server.id}
                variant="ghost"
                className={`w-full justify-start gap-3 px-3 text-sm font-normal ${
                  currentServer?.id === server.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground"
                }`}
                onClick={() => setCurrentServer(server)}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1 truncate text-left">{server.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {server.type}
                </Badge>
              </Button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
