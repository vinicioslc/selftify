import { useState, useEffect } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { Song, type AlbumArtist } from "../../types/domain-types";
import { getController } from "../../api/controller";
import { Avatar } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Play, ArrowLeft } from "lucide-react";
import { formatDuration } from "../../lib/utils";

interface ArtistPageProps {
  artist: AlbumArtist;
  onBack: () => void;
  onNavigateAlbum: (albumName: string, artistName: string) => void;
}

type GroupedAlbum = {
  name: string;
  songs: Song[];
  imageUrl: string | null;
};

export function ArtistPage({ artist, onBack, onNavigateAlbum }: ArtistPageProps) {
  const { setQueue } = usePlayerStore();
  const [albums, setAlbums] = useState<GroupedAlbum[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const controller = await getController();
        const allSongs = await controller.getArtistSongs(artist.name);
        const grouped: Record<string, GroupedAlbum> = {};
        for (const song of allSongs) {
          const key = song.albumName || "_nosongs";
          if (!grouped[key]) {
            grouped[key] = {
              name: song.albumName || "Other",
              songs: [],
              imageUrl: song.imageUrl,
            };
          }
          grouped[key].songs.push(song);
          if (!grouped[key].imageUrl && song.imageUrl) {
            grouped[key].imageUrl = song.imageUrl;
          }
        }
        const sorted = Object.values(grouped).sort((a, b) => {
          if (a.name === "Other") return 1;
          if (b.name === "Other") return -1;
          return a.name.localeCompare(b.name);
        });
        setAlbums(sorted);
      } catch {
        setAlbums([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [artist]);

  function playAll() {
    const all = albums.flatMap((a) => a.songs);
    if (all.length > 0) setQueue(all, { type: "now" });
  }

  function playAlbum(songs: Song[]) {
    if (songs.length > 0) setQueue(songs, { type: "now" });
  }

  function playSong(song: Song) {
    setQueue([song], { type: "now" });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-6 md:flex-row md:items-end md:gap-6">
        <Avatar
          src={artist.imageUrl}
          alt={artist.name}
          fallback={artist.name.charAt(0)}
          className="h-40 w-40 shrink-0 rounded-full md:h-48 md:w-48"
        />
        <div className="flex flex-col justify-end gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Artist</p>
          <h1 className="text-3xl font-bold">{artist.name}</h1>
          {artist.albumCount && artist.songCount && (
            <p className="text-sm text-muted-foreground">
              {artist.albumCount} albums &middot; {artist.songCount} songs
            </p>
          )}
          {albums.length > 0 && (
            <Button onClick={playAll} className="mt-2 w-fit gap-2">
              <Play className="h-4 w-4" /> Play All ({albums.flatMap((a) => a.songs).length})
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">Loading songs...</p>
          </div>
        ) : albums.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No songs found for this artist.</p>
          </div>
        ) : (
          <div className="max-w-3xl space-y-6">
            {albums.map((album) => (
              <section key={album.name}>
                <div className="mb-2 flex items-center gap-3">
                  <Avatar
                    src={album.imageUrl}
                    alt={album.name}
                    fallback={album.name.charAt(0)}
                    className="h-10 w-10 cursor-pointer rounded-md transition-opacity hover:opacity-80"
                    onClick={() => onNavigateAlbum(album.name, artist.name)}
                  />
                  <h2
                    className="cursor-pointer text-base font-semibold hover:underline"
                    onClick={() => onNavigateAlbum(album.name, artist.name)}
                  >
                    {album.name}
                  </h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-7 w-7"
                    onClick={() => playAlbum(album.songs)}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="space-y-0.5">
                  {album.songs.map((song, i) => (
                    <div
                      key={song.id}
                      className="group grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-accent"
                    >
                      <span className="w-6 text-right text-xs text-muted-foreground">
                        {song.trackNumber || i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm">{song.name}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {song.duration ? formatDuration(Math.round(song.duration)) : "--:--"}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100"
                          onClick={() => playSong(song)}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
