import { type ColumnDef } from "./data-table";
import { type Song } from "../../types/domain-types";
import { SongCoverImage } from "./song-cover-image";
import { formatDuration } from "../../lib/utils";

export interface SongColumnsOptions {
  onNavigateArtist?: (song: Song) => void;
  onNavigateAlbum?: (song: Song) => void;
  showSourceBadge?: boolean;
}

export function songTitleColumn(options: SongColumnsOptions): ColumnDef<Song> {
  const { onNavigateArtist, onNavigateAlbum, showSourceBadge } = options;

  return {
    id: "title",
    label: "Title",
    defaultVisible: true,
    width: showSourceBadge ? "1.5fr" : "1fr",
    sortable: true,
    sortValue: (s) => s.name,
    render: (song) => (
      <div className="flex min-w-0 items-center gap-3">
        <SongCoverImage
          song={song}
          alt={song.name}
          fallback={song.name.charAt(0)}
          className="h-10 w-10 shrink-0 rounded-md"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {song.youtubeVideoId && (
              <svg className="mr-1 inline-block h-3.5 w-3.5 text-red-500 align-text-bottom" viewBox="0 0 24 24" fill="currentColor" aria-label="Stream">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            )}
            {song.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            <span
              className="cursor-pointer hover:text-foreground hover:underline"
              onClick={(e) => { e.stopPropagation(); onNavigateArtist?.(song); }}
            >
              {song.artistName}
            </span>
            {song.albumName && (
              <>
                {" \u00b7 "}
                <span
                  className="cursor-pointer hover:text-foreground hover:underline"
                  onClick={(e) => { e.stopPropagation(); onNavigateAlbum?.(song); }}
                >
                  {song.albumName}
                </span>
              </>
            )}
          </p>
        </div>
      </div>
    ),
  };
}

export function sourceBadgeColumn(): ColumnDef<Song> {
  return {
    id: "source",
    label: "",
    width: "1.5rem",
    sortable: false,
    render: (song) =>
      song.id.startsWith("ytpure-") ? (
        <svg className="h-3.5 w-3.5 text-red-500" viewBox="0 0 24 24" fill="currentColor" aria-label="YouTube">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
      ) : (
        <span className="text-[10px] font-bold text-purple-500" title="MusicBrainz">MB</span>
      ),
  };
}

export function durationColumn(): ColumnDef<Song> {
  return {
    id: "duration",
    label: "Duration",
    width: "80px",
    sortable: true,
    sortValue: (s) => s.duration ?? 0,
    render: (song) => (
      <span className="text-xs text-muted-foreground">
        {song.duration ? formatDuration(Math.round(song.duration)) : "\u2014"}
      </span>
    ),
  };
}

/** Convenience: all standard columns in one call (source badge optional) */
export function songColumns(options: SongColumnsOptions): ColumnDef<Song>[] {
  const cols: ColumnDef<Song>[] = [];
  if (options.showSourceBadge) cols.push(sourceBadgeColumn());
  cols.push(songTitleColumn(options));
  cols.push(durationColumn());
  return cols;
}
