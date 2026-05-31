import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { usePlayerStore } from "../../stores/player.store";
import { getController } from "../../api/controller";
import { type Album, type AlbumArtist, OriginType } from "../../types/domain-types";
import type { AppView } from "../../types/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { AlbumCarousel } from "./album-carousel";
import { AlbumGrid } from "./album-grid";

type HomePageProps = {
  onNavigate?: (view: AppView) => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

const platformCards = [
  {
    id: "local",
    title: "Local Files",
    description: "Play music from your device storage",
    icon: "📁",
    route: "/setup/local",
    color: "from-purple-500/20 to-purple-700/20",
    borderColor: "border-purple-500/30",
  },
];

const quickActions = [
  { label: "Recently Played", icon: "🕐", route: "/local/songs?sort=recent" },
  { label: "Favorites", icon: "⭐", route: "/local/songs?filter=favorites" },
  { label: "Most Played", icon: "🔥", route: "/local/songs?sort=playcount" },
  { label: "Random", icon: "🎲", route: "/local/songs?sort=random" },
];

export function HomePage({ onNavigate, onNavigateAlbum, onNavigateArtist }: HomePageProps) {
  const { origins, currentOrigin, setCurrentOrigin } = useAuthStore();
  const { sidebarShowVisualizer, setSidebarShowVisualizer, theme, setTheme } = useSettingsStore();
  const { setQueue } = usePlayerStore();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAlbums = useCallback(async () => {
    if (!currentOrigin) {
      setAlbums([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const controller = await getController();
      const list = await controller.getAlbumList(0, 20);
      setAlbums(list);
    } catch (err) {
      console.error("[home] failed to load albums:", err);
      setError("Failed to load albums");
      setAlbums([]);
    } finally {
      setLoading(false);
    }
  }, [currentOrigin]);

  useEffect(() => {
    loadAlbums();
  }, [loadAlbums]);

  async function handlePlayAlbum(album: Album) {
    try {
      const controller = await getController();
      const songs = await controller.getAlbumSongs(album.albumArtistName, album.name);
      if (songs.length > 0) {
        setQueue(songs, { type: "now" });
      }
    } catch (err) {
      console.error("[home] failed to play album:", err);
    }
  }

  function handleNavigateAlbum(album: Album) {
    onNavigateAlbum?.(album);
  }

  const hasAlbums = albums.length > 0;
  const hasLocalOrigin = origins.some((o) => o.type === OriginType.LOCAL);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-5xl space-y-8 p-6">
          {/* Header */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              {currentOrigin ? currentOrigin.name : "Music Player"}
            </h1>
            <p className="text-muted-foreground">
              {currentOrigin
                ? `Browsing albums from ${currentOrigin.name}`
                : "Connect a music source to get started"}
            </p>
          </div>

          {/* Album Carousel */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {!loading && error && currentOrigin && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}

          {!loading && !error && hasAlbums && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Featured Albums</h2>
              <AlbumCarousel
                albums={albums}
                onPlayAlbum={handlePlayAlbum}
                onNavigateAlbum={handleNavigateAlbum}
              />
            </section>
          )}

          {/* Album Grid */}
          {!loading && !error && hasAlbums && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">All Albums</h2>
              <AlbumGrid
                albums={albums}
                onPlayAlbum={handlePlayAlbum}
                onNavigateAlbum={handleNavigateAlbum}
              />
            </section>
          )}

          {!loading && !error && currentOrigin && !hasAlbums && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">No albums found on this source.</p>
            </div>
          )}

          {/* Platform Cards */}
          {!hasLocalOrigin && (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Add Music Source</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {platformCards.map((card) => (
                  <Card
                    key={card.id}
                    className={`group relative overflow-hidden border transition-all hover:shadow-lg ${card.borderColor}`}
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
                      <Button size="sm" variant="outline" className="bg-background/80" onClick={() => onNavigate?.("settings")}>
                        Configure
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Quick Actions */}
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Quick Actions</h2>
            <div className="flex flex-wrap gap-3">
              {quickActions.map((action) => (
                <Button key={action.label} variant="outline" className="gap-2" onClick={() => onNavigate?.("search")}>
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
                variant={sidebarShowVisualizer ? "default" : "outline"}
                size="sm"
                onClick={() => setSidebarShowVisualizer(!sidebarShowVisualizer)}
              >
                {sidebarShowVisualizer ? "🎨 Visualizer On" : "🎨 Visualizer Off"}
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
