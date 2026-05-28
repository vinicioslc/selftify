import { useState } from "react";
import { getController } from "../../api/controller";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { Song, Album, AlbumArtist } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardDescription, CardTitle } from "../../components/ui/card";
import { Avatar } from "../../components/ui/avatar";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Badge } from "../../components/ui/badge";
import { Search, Play, Plus, Loader2 } from "lucide-react";

export function SearchPage() {
  const { currentServer } = useAuthStore();
  const { setQueue } = usePlayerStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ songs: Song[]; albums: Album[]; albumArtists: AlbumArtist[] } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch() {
    if (!query.trim() || !currentServer) return;
    setLoading(true);
    try {
      const controller = await getController();
      const res = await controller.search(query, 20);
      setResults(res);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setLoading(false);
    }
  }

  function playSong(song: Song) {
    setQueue([song], { type: "now" });
  }

  function playAll() {
    if (results?.songs.length) {
      setQueue(results.songs, { type: "now" });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Input
            placeholder={currentServer ? `Search ${currentServer.name}...` : "Add a server first"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button onClick={handleSearch} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {!results ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">
              {currentServer ? "Search for songs, albums, and artists" : "Connect to a server in Settings"}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-6 p-6">
            {/* Songs */}
            {results.songs.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Songs</h2>
                  <Button variant="outline" size="sm" onClick={playAll}>
                    Play All
                  </Button>
                </div>
                <div className="space-y-1">
                  {results.songs.map((song) => (
                    <div
                      key={song.id}
                      className="group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent"
                    >
                      <Avatar
                        src={song.imageUrl}
                        alt={song.name}
                        fallback={song.name.charAt(0)}
                        className="h-10 w-10 rounded-md"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{song.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{song.artistName}</p>
                      </div>
                      <Badge variant="outline" className="hidden text-xs sm:inline">
                        {song.albumName}
                      </Badge>
                      <Button variant="ghost" size="icon" onClick={() => playSong(song)}>
                        <Play className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Albums */}
            {results.albums.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Albums</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {results.albums.map((album) => (
                    <Card key={album.id} className="overflow-hidden transition-colors hover:bg-accent/50">
                      <CardContent className="p-0">
                        <Avatar
                          src={album.imageUrl}
                          alt={album.name}
                          fallback={album.name.charAt(0)}
                          className="h-32 w-full rounded-none md:h-40"
                        />
                        <div className="p-3">
                          <CardTitle className="truncate text-sm">{album.name}</CardTitle>
                          <CardDescription className="truncate text-xs">
                            {album.albumArtistName} {album.releaseYear ? `• ${album.releaseYear}` : ""}
                          </CardDescription>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {/* Artists */}
            {results.albumArtists.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Artists</h2>
                <div className="flex flex-wrap gap-4">
                  {results.albumArtists.map((artist) => (
                    <div key={artist.id} className="flex flex-col items-center gap-2">
                      <Avatar
                        src={artist.imageUrl}
                        alt={artist.name}
                        fallback={artist.name.charAt(0)}
                        className="h-20 w-20 rounded-full"
                      />
                      <p className="max-w-20 truncate text-center text-xs font-medium">{artist.name}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {results.songs.length === 0 && results.albums.length === 0 && results.albumArtists.length === 0 && (
              <div className="flex h-full items-center justify-center py-20">
                <p className="text-muted-foreground">No results found</p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
