import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { ServerType } from "../../types/domain-types";
import type { AppView } from "../../types/types";
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

type SidebarProps = {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
};

const navItems: { id: AppView; label: string; icon: any }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "library-albums", label: "Library", icon: Library },
  { id: "settings", label: "Settings", icon: Settings },
];

function serverIcon(type: ServerType | string): any {
  switch (type) {
    case ServerType.NAVIDROME: return Music;
    case ServerType.JELLYFIN: return Tv2;
    case ServerType.YOUTUBE_MUSIC: return Youtube;
    case "local":
    case ServerType.LOCAL: return FolderOpen;
    default: return Music;
  }
}

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  const { serverList, currentServer, setCurrentServer } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useSettingsStore();

  if (sidebarCollapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-2 border-r bg-sidebar p-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        {navItems.map((item) => (
          <Button
            key={item.id}
            variant={currentView === item.id ? "default" : "ghost"}
            size="icon"
            onClick={() => onNavigate(item.id)}
          >
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
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-bold tracking-tight">YT Music</h1>
        <Button variant="ghost" size="icon" onClick={toggleSidebar}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      <ScrollArea className="flex-1 px-2 py-2">
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant={currentView === item.id ? "secondary" : "ghost"}
              className="w-full justify-start gap-3 px-3 text-sm font-normal"
              onClick={() => onNavigate(item.id)}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Button>
          ))}
        </nav>

        <Separator className="my-3" />

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
