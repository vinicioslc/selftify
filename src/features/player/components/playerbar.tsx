import type { Album, AlbumArtist } from "../../../types/domain-types";
import { usePlayerStore } from "../../../stores/player.store";
import { useSettingsStore } from "../../../stores/settings.store";
import { useIsCompact } from "../../../hooks/use-is-compact";
import { LeftControls } from "./left-controls";
import { CenterControls } from "./center-controls";
import { RightControls } from "./right-controls";
import { CompactPlayerBar } from "./compact-playerbar";

type PlayerbarProps = {
  currentView?: string;
  onNavigate?: (view: any) => void;
  onGoBack?: () => void;
  onOpenQueue?: () => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

export function PlayerBar({ currentView, onNavigate, onGoBack, onOpenQueue, onNavigateAlbum, onNavigateArtist }: PlayerbarProps) {
  const { currentTrack } = usePlayerStore();
  const { sidebarCollapsed } = useSettingsStore();
  const isCompact = useIsCompact();

  if (isCompact) {
    return <CompactPlayerBar onOpenQueue={onOpenQueue} onNavigateAlbum={onNavigateAlbum} onNavigateArtist={onNavigateArtist} />;
  }

  return (
    <div className="playerbar-grid">
      <div className="playerbar-section left">
        <LeftControls onNavigate={onNavigate} onNavigateAlbum={onNavigateAlbum} onNavigateArtist={onNavigateArtist} />
      </div>
      <div className="playerbar-section center">
        {currentTrack ? (
          <CenterControls />
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a track to play
          </p>
        )}
      </div>
      <div className="playerbar-section right">
        <RightControls onOpenQueue={onOpenQueue} onNavigateAlbum={onNavigateAlbum} onNavigateArtist={onNavigateArtist} />
      </div>
    </div>
  );
}
