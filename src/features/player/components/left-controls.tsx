import { usePlayerStore } from "../../../stores/player.store";
import { useSettingsStore } from "../../../stores/settings.store";
import { CoverImage } from "../../../components/ui/art-image";
import { Button } from "../../../components/ui/button";
import { ChevronUp, AudioLines, Sparkles, BarChart3 } from "lucide-react";
import type { VisualizerType } from "../../../stores/settings.store";
import type { Album, AlbumArtist } from "../../../types/domain-types";
import { buildArtistNav, buildAlbumNav } from "../../../lib/build-navigation";

export function LeftControls({ onNavigate, onNavigateAlbum, onNavigateArtist }: { onNavigate?: (view: any) => void; onNavigateAlbum?: (album: Album) => void; onNavigateArtist?: (artist: AlbumArtist) => void }) {
  const { currentTrack } = usePlayerStore();
  const { sidebarShowVisualizer, setSidebarShowVisualizer, sidebarAlbumCollapsed, setSidebarAlbumCollapsed, visualizerType, setVisualizerType } = useSettingsStore();

  if (!currentTrack) {
    return (
      <div className="flex h-full items-center gap-3 px-2">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted">
          <span className="text-xl text-muted-foreground">♪</span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">No track playing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center gap-3 px-2">
      {/* Cover — slides left when sidebar cover is expanded */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          width: sidebarAlbumCollapsed ? "var(--player-bar-height)" : "0px",
          opacity: sidebarAlbumCollapsed ? 1 : 0,
          flexShrink: 0,
        }}
      >
        <div className="group relative" style={{ width: "var(--player-bar-height)", height: "100%" }}>
          <Button
            variant="ghost"
            className="h-full w-full shrink-0 overflow-hidden rounded-none p-0"
          >
            <CoverImage
              src={currentTrack.imageUrl}
              alt={currentTrack.name}
              fallback={currentTrack.name.charAt(0)}
              className="h-full w-full object-cover"
            />
          </Button>
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/50 group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white"
              onClick={(e) => {
                e.stopPropagation();
                setSidebarAlbumCollapsed(false);
              }}
            >
              <ChevronUp className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-col min-w-0">
        <button
          className="truncate text-sm font-medium text-foreground hover:underline text-left"
          onClick={() => {
            if (currentTrack.albumName) {
              const nav = buildAlbumNav(currentTrack);
              if (nav) onNavigateAlbum?.(nav);
            }
          }}
        >
          {currentTrack.name}
        </button>
        <span
          className="cursor-pointer truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => onNavigateArtist?.(buildArtistNav(currentTrack))}
        >
          {currentTrack.artistName}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 ${sidebarShowVisualizer ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        onClick={() => setSidebarShowVisualizer(!sidebarShowVisualizer)}
      >
        <AudioLines className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => {
          const types: VisualizerType[] = ["none", "butterchurn", "audiomotion"];
          const idx = types.indexOf(visualizerType);
          const next = types[(idx + 1) % types.length];
          setVisualizerType(next);
          if (next !== "none") setSidebarShowVisualizer(true);
        }}
        title={`Visualizer: ${visualizerType}`}
      >
        {visualizerType === "butterchurn" ? (
          <Sparkles className="h-4 w-4" />
        ) : visualizerType === "audiomotion" ? (
          <BarChart3 className="h-4 w-4" />
        ) : (
          <span className="text-xs font-bold">OFF</span>
        )}
      </Button>
    </div>
  );
}
