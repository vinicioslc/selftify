import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { useStatusStore } from "../../stores/status.store";
import { createPlaylist, deletePlaylist, getAllPlaylists } from "../../services/playlist-service";
import { getController } from "../../api/controller";
import { type Album, type AlbumArtist, type Playlist } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "../../components/ui/dialog";
import { Plus, Play, Trash2, ListMusic, Music } from "lucide-react";

interface PlaylistListPageProps {
  onNavigatePlaylist: (playlist: Playlist) => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
}

export function PlaylistListPage({ onNavigatePlaylist, onNavigateAlbum, onNavigateArtist }: PlaylistListPageProps) {
  const { currentOrigin } = useAuthStore();
  const { setQueue } = usePlayerStore();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadPlaylists = useCallback(async () => {
    if (!currentOrigin) {
      setPlaylists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const controller = await getController();
      const list = await controller.getPlaylistList();
      setPlaylists(list);
    } catch (err) {
      console.error("[playlist-list] failed to load playlists:", err);
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  }, [currentOrigin]);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  async function handleCreate() {
    if (!newName.trim() || !currentOrigin) return;
    try {
      const db = await createPlaylist(newName.trim(), currentOrigin.id);
      useStatusStore.getState().addMessage(`Playlist "${db.name}" created`, "success", "Playlist");
      setNewName("");
      setDialogOpen(false);
      loadPlaylists();
    } catch (err) {
      console.error("[playlist-list] create error:", err);
      useStatusStore.getState().addMessage("Failed to create playlist", "danger", "Playlist");
    }
  }

  async function handleDelete(e: React.MouseEvent, playlist: Playlist) {
    e.stopPropagation();
    try {
      await deletePlaylist(playlist.id);
      useStatusStore.getState().addMessage(`Playlist "${playlist.name}" deleted`, "info", "Playlist");
      loadPlaylists();
    } catch (err) {
      console.error("[playlist-list] delete error:", err);
    }
  }

  async function handlePlay(e: React.MouseEvent, playlist: Playlist) {
    e.stopPropagation();
    try {
      const { getPlaylistSongIds } = await import("../../services/playlist-service");
      const mbids = await getPlaylistSongIds(playlist.id);
      if (mbids.length === 0) return;
      const { getSongByMbid } = await import("../../api/local/local-queries");
      const { sqliteDbTrackToSong } = await import("../../services/sqlite-db/sqlite-db-resolver");
      const songs = (await Promise.all(mbids.map((mbid) => getSongByMbid(mbid))))
        .filter(Boolean)
        .map((track) => sqliteDbTrackToSong(track!, currentOrigin!.id, "local" as any));
      if (songs.length === 0) return;
      setQueue(songs, { type: "now" });
      useStatusStore.getState().addMessage(`Playing "${playlist.name}"`, "info", "Playlist");
    } catch (err) {
      console.error("[playlist-list] play error:", err);
    }
  }

  function relativeDate(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Playlists</h1>
              <p className="text-muted-foreground mt-1">
                {playlists.length > 0
                  ? `${playlists.length} playlist${playlists.length !== 1 ? "s" : ""}`
                  : "Organize your music"}
              </p>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  New Playlist
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Playlist</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <Input
                    placeholder="Playlist name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                    }}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleCreate} disabled={!newName.trim()}>
                      Create
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}

          {/* Playlist Grid */}
          {!loading && playlists.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 uw:grid-cols-5">
              {playlists.map((playlist) => (
                <Card
                  key={playlist.id}
                  className="group cursor-pointer transition-all hover:shadow-md"
                  onClick={() => onNavigatePlaylist(playlist)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                        <ListMusic className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => handlePlay(e, playlist)}
                          title="Play all"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={(e) => handleDelete(e, playlist)}
                          title="Delete playlist"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <CardTitle className="mt-3 truncate text-base">
                      {playlist.name}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {playlist.songCount ?? 0} song{(playlist.songCount ?? 0) !== 1 ? "s" : ""}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}

          {/* Empty State */}
          {!loading && playlists.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Music className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">No playlists yet</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-xs">
                Create your first playlist to start organizing your music.
              </p>
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Playlist
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
