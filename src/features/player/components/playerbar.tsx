import { usePlayerStore } from "../../../stores/player.store";
import { useSettingsStore } from "../../../stores/settings.store";
import { LeftControls } from "./left-controls";
import { CenterControls } from "./center-controls";
import { RightControls } from "./right-controls";

type PlayerbarProps = {
  onNavigate?: (view: any) => void;
};

export function PlayerBar({ onNavigate }: PlayerbarProps) {
  const { currentTrack } = usePlayerStore();
  const { sidebarCollapsed } = useSettingsStore();

  return (
    <div className="playerbar-grid">
      <div className="playerbar-section left">
        <LeftControls onNavigate={onNavigate} />
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
