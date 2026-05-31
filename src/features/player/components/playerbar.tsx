import type { Album, AlbumArtist } from "../../../types/domain-types";
import { usePlayerStore } from "../../../stores/player.store";
import { useSettingsStore } from "../../../stores/settings.store";
import { LeftControls } from "./left-controls";
import { CenterControls } from "./center-controls";
import { RightControls } from "./right-controls";

type PlayerbarProps = {
  onNavigate?: (view: any) => void;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

export function PlayerBar({ onNavigate, onNavigateAlbum, onNavigateArtist }: PlayerbarProps) {
  const { currentTrack } = usePlayerStore();
  const { sidebarCollapsed } = useSettingsStore();

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
        <RightControls onNavigate={onNavigate} />
      </div>
    </div>
  );
}
