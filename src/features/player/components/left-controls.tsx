import { usePlayerStore } from "../../../stores/player.store";
import { useSettingsStore } from "../../../stores/settings.store";
import { Avatar } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";

export function LeftControls({ onNavigate }: { onNavigate?: (view: any) => void }) {
  const { currentTrack } = usePlayerStore();
  const { setVisualizerEnabled, visualizerEnabled } = useSettingsStore();

  if (!currentTrack) {
    return (
      <div className="flex h-full items-center gap-3 px-2">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
          <span className="text-lg text-muted-foreground">♪</span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">No track playing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center gap-3 px-2">
      <Button
        variant="ghost"
        className="h-14 w-14 shrink-0 overflow-hidden rounded-lg p-0"
        onClick={() => onNavigate?.("now-playing")}
      >
        <Avatar
          src={currentTrack.imageUrl}
          alt={currentTrack.name}
          fallback={currentTrack.name.charAt(0)}
          className="h-full w-full rounded-lg"
        />
      </Button>
      <div className="min-w-0 max-w-[20vw]">
        <button
          className="truncate text-sm font-medium hover:underline"
          onClick={() => onNavigate?.("now-playing")}
        >
          {currentTrack.name}
        </button>
        <p className="truncate text-xs text-muted-foreground">{currentTrack.artistName}</p>
        {currentTrack.albumName && (
          <p className="truncate text-xs text-muted-foreground/70">{currentTrack.albumName}</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setVisualizerEnabled(!visualizerEnabled)}
      >
        <span className="text-sm">{visualizerEnabled ? "🎨" : "▫"}</span>
      </Button>
    </div>
  );
}
