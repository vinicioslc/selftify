import { useState, useEffect } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { Song, type Album } from "../../types/domain-types";
import { getController } from "../../api/controller";
import { Avatar } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Play, ArrowLeft, Clock } from "lucide-react";
import { formatDuration } from "../../lib/utils";

interface AlbumPageProps {
  album: Album;
  onBack: () => void;
}

export function AlbumPage({ album, onBack }: AlbumPageProps) {
  const { setQueue } = usePlayerStore();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const controller = await getController();
        const result = await controller.getAlbumSongs(album.albumArtistName, album.name);
        setSongs(result.filter((s) => s.albumName === album.name || s.albumName === undefined));
      } catch {
        setSongs([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [album]);

  function playAll() {
    if (songs.length > 0) {
      setQueue(songs, { type: "now" });
    }
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

      <div className="flex flex-col gap-6 p-6 md:flex-row">
        <Avatar
          src={album.imageUrl}
          alt={album.name}
          fallback={album.name.charAt(0)}
          className="h-48 w-48 shrink-0 rounded-lg md:h-56 md:w-56"
        />
        <div className="flex flex-col justify-end gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Album</p>
          <h1 className="text-3xl font-bold">{album.name}</h1>
          <p className="text-lg text-muted-foreground">
            {album.albumArtistName}
            {album.releaseYear && <> &middot; {album.releaseYear}</>}
          </p>
          {album.songCount && (
            <p className="text-sm text-muted-foreground">
              {album.songCount} songs
              {album.duration ? <> &middot; {formatDuration(Math.round(album.duration / album.songCount * 1000))} avg</> : null}
            </p>
          )}
          {songs.length > 0 && (
            <Button onClick={playAll} className="mt-2 w-fit gap-2">
              <Play className="h-4 w-4" /> Play All
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 px-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">Loading songs...</p>
          </div>
        ) : songs.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No songs found in this album.</p>
          </div>
        ) : (
          <div className="max-w-3xl">
            <div className="mb-2 grid grid-cols-[auto_1fr_auto] gap-2 px-2 py-1 text-xs text-muted-foreground">
              <span className="w-8 text-right">#</span>
              <span>Title</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
              </span>
            </div>
            {songs.map((song, i) => (
              <div
                key={song.id}
                className="group grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
              >
                <span className="w-8 text-right text-sm text-muted-foreground">
                  {song.trackNumber || i + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{song.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{song.artistName}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {song.duration ? formatDuration(Math.round(song.duration)) : "--:--"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100"
                    onClick={() => playSong(song)}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
