import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { ServerType } from "../../types/domain-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";

const platformCards = [
  {
    id: "navidrome",
    title: "Navidrome",
    description: "Connect to your Navidrome server via Subsonic API",
    icon: "🎵",
    type: ServerType.NAVIDROME,
    route: "/setup/navidrome",
    color: "from-emerald-500/20 to-emerald-700/20",
    borderColor: "border-emerald-500/30",
  },
  {
    id: "jellyfin",
    title: "Jellyfin",
    description: "Stream from your Jellyfin media server",
    icon: "🎬",
    type: ServerType.JELLYFIN,
    route: "/setup/jellyfin",
    color: "from-blue-500/20 to-blue-700/20",
    borderColor: "border-blue-500/30",
  },
  {
    id: "youtube",
    title: "YouTube Music",
    description: "Play music via YouTube Music API (cookie auth)",
    icon: "▶️",
    type: ServerType.YOUTUBE_MUSIC,
    route: "/setup/youtube",
    color: "from-red-500/20 to-red-700/20",
    borderColor: "border-red-500/30",
  },
  {
    id: "local",
    title: "Local Files",
    description: "Play MP3 files from your device storage",
    icon: "📁",
    type: "local" as any,
    route: "/setup/local",
    color: "from-purple-500/20 to-purple-700/20",
    borderColor: "border-purple-500/30",
  },
];

const quickActions = [
  { label: "Recently Played", icon: "🕐", route: "/library/songs?sort=recent" },
  { label: "Favorites", icon: "⭐", route: "/library/songs?filter=favorites" },
  { label: "Most Played", icon: "🔥", route: "/library/songs?sort=playcount" },
  { label: "Random", icon: "🎲", route: "/library/songs?sort=random" },
];

export function HomePage() {
  const { serverList, currentServer, setCurrentServer } = useAuthStore();
  const { visualizerEnabled, setVisualizerEnabled, theme, setTheme } = useSettingsStore();

  const activeServers = serverList.filter((s) => s.type !== ServerType.LOCAL);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-5xl space-y-8 p-6">
          {/* Header */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">YT Music Player</h1>
            <p className="text-muted-foreground">
              Cross-platform music player for your favorite services
            </p>
          </div>

          {/* Connected Servers */}
          {activeServers.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Connected Servers</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeServers.map((server) => (
                  <Card
                    key={server.id}
                    className={`cursor-pointer transition-all hover:shadow-md ${currentServer?.id === server.id ? "ring-2 ring-primary" : ""}`}
                    onClick={() => setCurrentServer(server)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{server.name}</CardTitle>
                        <Badge variant={currentServer?.id === server.id ? "default" : "secondary"}>
                          {server.type}
                        </Badge>
                      </div>
                      <CardDescription>{server.url}</CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Platform Cards */}
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Add Music Source</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {platformCards.map((card) => {
                const isConnected = serverList.some((s) => s.type === card.type || (card.type === "local" as any));
                return (
                  <Card
                    key={card.id}
                    className={`group relative overflow-hidden border transition-all hover:shadow-lg ${card.borderColor} ${isConnected ? "opacity-60" : ""}`}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${card.color} opacity-50`} />
                    <CardHeader className="relative">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{card.icon}</span>
                        <div>
                          <CardTitle>{card.title}</CardTitle>
                          <CardDescription className="mt-1">{card.description}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="relative">
                      {isConnected ? (
                        <Badge variant="secondary">Connected</Badge>
                      ) : (
                        <Button size="sm" variant="outline" className="bg-background/80">
                          Configure
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* Quick Actions */}
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Quick Actions</h2>
            <div className="flex flex-wrap gap-3">
              {quickActions.map((action) => (
                <Button key={action.label} variant="outline" className="gap-2">
                  <span>{action.icon}</span>
                  {action.label}
                </Button>
              ))}
            </div>
          </section>

          {/* Quick Settings */}
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Quick Settings</h2>
            <div className="flex flex-wrap gap-4">
              <Button
                variant={visualizerEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => setVisualizerEnabled(!visualizerEnabled)}
              >
                {visualizerEnabled ? "🎨 Visualizer On" : "🎨 Visualizer Off"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode"}
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
