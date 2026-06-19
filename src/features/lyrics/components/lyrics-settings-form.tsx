import { useSettingsStore, type LyricsSettings } from "../../../stores/settings.store";
import { LyricSource } from "../../../types/lyrics-types";
import { Label } from "../../../components/ui/label";
import { Switch } from "../../../components/ui/switch";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";

const ALL_SOURCES = [LyricSource.LRCLIB, LyricSource.NETEASE] as const;
const ALIGNMENTS = ["center", "left", "right"] as const;

export function LyricsSettingsForm() {
  const lyrics = useSettingsStore((s) => s.lyrics);
  const setLyricsSettings = useSettingsStore((s) => s.setLyricsSettings);

  const update = (partial: Partial<LyricsSettings>) => {
    setLyricsSettings(partial);
  };

  const toggleSource = (source: LyricSource) => {
    const current = lyrics.sources;
    if (current.includes(source)) {
      update({ sources: current.filter((s) => s !== source) });
    } else {
      update({ sources: [...current, source] });
    }
  };

  return (
    <div className="space-y-6">
      {/* Fetch Settings */}
      <div>
        <h3 className="text-sm font-medium mb-3">Fetch Settings</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="fetch-lyrics" className="text-sm">Enable lyrics fetching</Label>
            <Switch
              id="fetch-lyrics"
              checked={lyrics.fetch}
              onCheckedChange={(v) => update({ fetch: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm">Prefer local lyrics</Label>
            <Switch
              checked={lyrics.preferLocalLyrics}
              onCheckedChange={(v) => update({ preferLocalLyrics: v })}
            />
          </div>

          <div>
            <Label className="text-sm block mb-2">Lyric sources</Label>
            <div className="flex gap-2 flex-wrap">
              {ALL_SOURCES.map((source) => (
                <Badge
                  key={source}
                  variant={lyrics.sources.includes(source) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleSource(source)}
                >
                  {source}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="netease-translation" className="text-sm">NetEase translation merge</Label>
            <Switch
              id="netease-translation"
              checked={lyrics.enableNeteaseTranslation}
              onCheckedChange={(v) => update({ enableNeteaseTranslation: v })}
            />
          </div>
        </div>
      </div>

      {/* Display Settings */}
      <div>
        <h3 className="text-sm font-medium mb-3">Display Settings</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="font-size" className="text-sm">Font size (synced)</Label>
            <Input
              id="font-size"
              type="number"
              className="w-20 h-8"
              value={lyrics.fontSize}
              onChange={(e) => update({ fontSize: parseInt(e.target.value) || 24 })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="font-size-unsync" className="text-sm">Font size (unsynced)</Label>
            <Input
              id="font-size-unsync"
              type="number"
              className="w-20 h-8"
              value={lyrics.fontSizeUnsync}
              onChange={(e) => update({ fontSizeUnsync: parseInt(e.target.value) || 24 })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="gap" className="text-sm">Gap between lines (synced)</Label>
            <Input
              id="gap"
              type="number"
              className="w-20 h-8"
              value={lyrics.gap}
              onChange={(e) => update({ gap: parseInt(e.target.value) || 24 })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="gap-unsync" className="text-sm">Gap between lines (unsynced)</Label>
            <Input
              id="gap-unsync"
              type="number"
              className="w-20 h-8"
              value={lyrics.gapUnsync}
              onChange={(e) => update({ gapUnsync: parseInt(e.target.value) || 24 })}
            />
          </div>

          <div>
            <Label className="text-sm block mb-2">Alignment</Label>
            <div className="flex gap-2">
              {ALIGNMENTS.map((align) => (
                <Button
                  key={align}
                  variant={lyrics.alignment === align ? "default" : "outline"}
                  size="sm"
                  onClick={() => update({ alignment: align })}
                >
                  {align.charAt(0).toUpperCase() + align.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="follow" className="text-sm">Auto-follow playback</Label>
            <Switch
              id="follow"
              checked={lyrics.follow}
              onCheckedChange={(v) => update({ follow: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="show-provider" className="text-sm">Show provider credit</Label>
            <Switch
              id="show-provider"
              checked={lyrics.showProvider}
              onCheckedChange={(v) => update({ showProvider: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="show-match" className="text-sm">Show match info</Label>
            <Switch
              id="show-match"
              checked={lyrics.showMatch}
              onCheckedChange={(v) => update({ showMatch: v })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
