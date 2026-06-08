import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { useStatusStore } from "../../stores/status.store";
import {
  getPlaylistSongIds,
  removeSongFromPlaylist,
  renamePlaylist,
  deletePlaylist,
} from "../../services/playlist-service";
import { getSongByMbid } from "../../services/local-database";
import { dbSongToSong } from "../../services/dto";
import type { Album, AlbumArtist, Playlist, Song } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { CoverImage } from "../../components/ui/art-image";
import { DataTable, type ColumnDef } from "../shared/data-table";
import { formatDuration } from "../../lib/utils";
import { ArrowLeft, Play, Trash2, Pencil, X, Check } from "lucide-react";
import { useState as useStateFn } from "react";

interface PlaylistDetailPageProps {
  playlist: Playlist;
  onBack: () => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
}

export function PlaylistDetailPage({ playlist, onBack, onNavigateAlbum, onNavigateArtist }: PlaylistDetailPageProps) {
  const { currentOrigin } = useAuthStore();
  const { setQueue } = usePlayerStore();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(playlist.name);
  const [songCount, setSongCount] = useState(playlist.songCount ?? 0);

  const loadSongs = useCallback(async () => {
    setLoading(true);
    try {
      const mbids = await getPlaylistSongIds(playlist.id);
      if (mbids.length === 0) {
        setSongs([]);
        setSongCount(0);
        return;
      }
      const dbSongs = (await Promise.all(mbids.map((mbid) => getSongByMbid(mbid)))).filter(Boolean);
      const originId = currentOrigin?.id || playlist.originId;
      const mapped = dbSongs.map((s) => dbSongToSong(s!, originId));
      setSongs(mapped);
      setSongCount(mapped.length);
    } catch (err) {
      console.error("[playlist-detail] load error:", err);
      setSongs([]);
    } finally {
      setLoading(false);
    }
  }, [playlist.id, playlist.originId, currentOrigin]);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  async function handlePlayAll() {
    if (songs.length === 0) return;
    setQueue(songs, { type: "now" });
    useStatusStore.getState().addMessage(`Playing "${playlist.name}"`, "info", "Playlist");
  }

  async function handleRemoveSong(song: Song) {
    const mbid = song.mbzRecordingId || song.id;
    await removeSongFromPlaylist(playlist.id, mbid);
    setSongs((prev) => prev.filter((s) => (s.mbzRecordingId || s.id) !== mbid));
    setSongCount((c) => c - 1);
    useStatusStore.getState().addMessage(`Removed from "${playlist.name}"`, "info", "Playlist");
  }

  async function handleRename() {
    if (!newName.trim() || newName.trim() === playlist.name) {
      setIsRenaming(false);
      return;
    }
    await renamePlaylist(playlist.id, newName.trim());
    playlist.name = newName.trim();
    setIsRenaming(false);
    useStatusStore.getState().addMessage(`Playlist renamed`, "success", "Playlist");
  }

  async function handleDelete() {
    await deletePlaylist(playlist.id);
    useStatusStore.getState().addMessage(`"${playlist.name}" deleted`, "info", "Playlist");
    onBack();
  }

  function handlePlaySong(song: Song) {
    setQueue([song], { type: "now" });
  }

  const columns: ColumnDef<Song>[] = [
    {
      id: "cover",
      label: "",
      width: "44px",
      render: (song) => (
        <CoverImage
          src={song.imageUrl || undefined}
          alt={song.name}
          fallback={song.name.charAt(0)}
          className="h-9 w-9 rounded object-cover"
        />
      ),
    },
    {
      id: "titleArtist",
      label: "Title & Artist",
      sortable: true,
      sortValue: (s) => `${s.name} ${s.artistName}`,
      render: (song) => (
        <div>
          <p className="truncate text-sm font-medium">{song.name}</p>
          <p className="truncate text-xs text-muted-foreground">{song.artistName}</p>
        </div>
      ),
    },
    {
      id: "album",
      label: "Album",
      sortable: true,
      sortValue: (s) => s.albumName ?? "",
      render: (song) => (
        <span className="truncate text-sm text-muted-foreground">{song.albumName || "—"}</span>
      ),
    },
    {
      id: "duration",
      label: "⏱",
      width: "64px",
      sortable: true,
      sortValue: (s) => s.duration ?? 0,
      render: (song) => (
        <span className="text-sm text-muted-foreground">{formatDuration(song.duration)}</span>
      ),
    },
    {
      id: "remove",
      label: "",
      width: "40px",
      render: (song) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            handleRemoveSong(song);
          }}
          title="Remove from playlist"
        >
          <X className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {/* Back */}
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Playlists
          </button>

          {/* Header */}
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                {isRenaming ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename();
                        if (e.key === "Escape") { setNewName(playlist.name); setIsRenaming(false); }
                      }}
                      className="h-9 text-xl font-bold"
                      autoFocus
                    />
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleRename}>
                      <Check className="h-4 w-4 text-green-500" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => { setNewName(playlist.name); setIsRenaming(false); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h1 className="text-3xl font-bold tracking-tight">{playlist.name}</h1>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsRenaming(true)} title="Rename">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  {songCount} song{songCount !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handlePlayAll} disabled={songs.length === 0}>
                  <Play className="mr-2 h-4 w-4" />
                  Play All
                </Button>
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={handleDelete}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </div>

          {/* Song List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : songs.length > 0 ? (
            <DataTable
              data={songs}
              columns={columns}
              getRowId={(s) => s.id}
              onRowClick={(song) => handlePlaySong(song)}
              emptyMessage="This playlist is empty."
              storageKey={`playlist-${playlist.id}`}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Play className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">This playlist is empty</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-xs">
                Add songs from the library or search results.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
