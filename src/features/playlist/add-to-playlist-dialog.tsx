import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { createPlaylist, getAllPlaylists, addSongToPlaylist, isSongInPlaylist } from "../../services/playlist-service";
import type { Song, Playlist } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "../../components/ui/dialog";
import { Plus, Check, ListMusic, Search } from "lucide-react";

interface AddToPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: Song;
}

export function AddToPlaylistDialog({ open, onOpenChange, song }: AddToPlaylistDialogProps) {
  const { currentOrigin } = useAuthStore();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);
  const [songsInPlaylists, setSongsInPlaylists] = useState<Set<string>>(new Set());

  const songMbid = song.mbzRecordingId;

  const loadPlaylists = useCallback(async () => {
    if (!open || !songMbid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await getAllPlaylists();
      const mapped: Playlist[] = list.map((p) => ({
        id: p.id,
        originId: p.originId,
        originType: "local" as any,
        name: p.name,
        songCount: p.songCount,
        imageUrl: null,
      }));
      setPlaylists(mapped);

      const inPl = new Set<string>();
      for (const p of list) {
        const inPlaylist = await isSongInPlaylist(p.id, songMbid);
        if (inPlaylist) inPl.add(p.id);
      }
      setSongsInPlaylists(inPl);
    } catch (err) {
      console.error("[add-to-playlist] load error:", err);
    } finally {
      setLoading(false);
    }
  }, [open, songMbid]);

  useEffect(() => {
    if (open) {
      loadPlaylists();
      setSearchQuery("");
      setNewName("");
      setShowNewInput(false);
    }
  }, [open, loadPlaylists]);

  async function handleAddToPlaylist(playlistId: string) {
    if (!songMbid) return;
    await addSongToPlaylist(playlistId, songMbid);
    setSongsInPlaylists((prev) => new Set(prev).add(playlistId));
    useStatusStore.getState().addMessage(`Added to playlist`, "success", "Playlist");
  }

  async function handleCreateAndAdd() {
    if (!newName.trim() || !currentOrigin || !songMbid) return;
    const pl = await createPlaylist(newName.trim(), currentOrigin.id);
    await addSongToPlaylist(pl.id, songMbid);
    useStatusStore.getState().addMessage(`Added to "${pl.name}"`, "success", "Playlist");
    onOpenChange(false);
  }

  const filteredPlaylists = playlists.filter(
    (p) => p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Playlist</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Search */}
          {playlists.length > 3 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search playlists..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {/* Playlist list */}
          <ScrollArea className="max-h-60">
            <div className="space-y-1">
              {loading ? (
                <div className="flex justify-center py-4">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : filteredPlaylists.length > 0 ? (
                filteredPlaylists.map((p) => {
                  const alreadyAdded = songsInPlaylists.has(p.id);
                  return (
                    <button
                      key={p.id}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        alreadyAdded
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent hover:text-accent-foreground"
                      }`}
                      onClick={() => {
                        if (!alreadyAdded) handleAddToPlaylist(p.id);
                      }}
                      disabled={alreadyAdded}
                    >
                      <ListMusic className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.songCount ?? 0}
                      </span>
                      {alreadyAdded && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {searchQuery ? "No playlists match your search" : "No playlists yet"}
                </p>
              )}
            </div>
          </ScrollArea>

          {/* New Playlist */}
          {showNewInput ? (
            <div className="flex items-center gap-2">
              <Input
                placeholder="New playlist name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateAndAdd();
                  if (e.key === "Escape") setShowNewInput(false);
                }}
                autoFocus
              />
              <Button size="sm" onClick={handleCreateAndAdd} disabled={!newName.trim()}>
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewInput(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <button
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-accent"
              onClick={() => setShowNewInput(true)}
            >
              <Plus className="h-4 w-4" />
              <span>New Playlist</span>
            </button>
          )}

          {/* Footer */}
          <div className="flex justify-end pt-1">
            <DialogClose asChild>
              <Button variant="outline" size="sm">Close</Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
