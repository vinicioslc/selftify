import { useRankingDebugStore } from "../../stores/ranking-debug.store";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Trash2, X } from "lucide-react";
import { cn } from "../../lib/utils";

export function YoutubeRankingDebug({ onClose }: { onClose?: () => void }) {
  const { entries, clear } = useRankingDebugStore();
  console.log("[debug-ui] render: entries:", entries.length);
  const latest = entries[entries.length - 1];
  const scored = latest?.scored ?? [];

  return (
    <div className="flex h-full flex-col bg-background border-l text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="font-semibold text-sm">YT Ranking Debug</span>
        <div className="flex items-center gap-1">
          {entries.length > 0 && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clear} title="Clear">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 p-3">
        {!latest ? (
          <p className="text-muted-foreground text-center py-8">No ranking data yet.<br />Play a MusicBrainz song to see results.</p>
        ) : (
          <div className="space-y-3">
            {/* Query info */}
            <div className="rounded-md bg-muted/40 p-2 space-y-1">
              <p className="text-muted-foreground">
                Search: <span className="text-foreground font-medium">{latest.searchQuery}</span>
              </p>
              <p className="text-muted-foreground">
                Candidates: <span className="text-foreground">{scored.length}</span>
                {latest.duration != null && (
                  <> · Expected duration: <span className="text-foreground">{latest.duration}s</span></>
                )}
              </p>
              <p className="text-muted-foreground">
                Selected: <span className="text-green-500 font-medium">{latest.selectedVideoId}</span>
              </p>
            </div>

            {/* Ranked results */}
            <div className="space-y-1">
              {scored.length === 0 ? (
                <div className="rounded-md bg-muted/20 p-3 text-center text-xs text-muted-foreground">
                  {latest.selectedVideoId ? "Cached result — no ranking performed" : "No YouTube results found for this query"}
                </div>
              ) : (
                <>
              <p className="text-muted-foreground font-medium mb-2">Ranked results (highest score first)</p>
              {scored.map((item, i) => {
                const isSelected = item.video.id === latest.selectedVideoId;
                const score = item.breakdown.score;
                return (
                  <div
                    key={item.video.id + "-" + i}
                    className={cn(
                      "rounded-md p-2 border transition-colors",
                      isSelected
                        ? "border-green-500 bg-green-500/10"
                        : "border-transparent bg-muted/20 hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate font-medium", isSelected && "text-green-500")}>
                          {item.video.title}
                        </p>
                        <p className="truncate text-muted-foreground">{item.video.uploader || "—"}</p>
                      </div>
                      <Badge variant={isSelected ? "default" : "secondary"} className="shrink-0 text-[10px]">
                        {score.toFixed(2)}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>T:{booleanToIcon(item.breakdown.titleMatch)}</span>
                      <span>A:{booleanToIcon(item.breakdown.artistMatch)}</span>
                      <span>Al:{booleanToIcon(item.breakdown.albumMatch)}</span>
                      <span>D:{booleanToIcon(item.breakdown.exactDuration)}</span>
                      <span>~D:{booleanToIcon(item.breakdown.closestDuration)}</span>
                      {item.video.duration && (
                        <span>⏱{typeof item.video.duration === "number" ? item.video.duration : (item.video.duration as any).seconds ?? "?"}s</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{item.video.id}</p>
                  </div>
                );
              })}
              </>
            )}
            </div>

            {/* Previous entries */}
            {entries.length > 1 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground">
                  Previous searches ({entries.length - 1})
                </summary>
                <div className="mt-2 space-y-1">
                  {entries.slice(0, -1).reverse().map((e, i) => (
                    <div key={i} className="rounded bg-muted/20 px-2 py-1 text-[10px] text-muted-foreground">
                      <p className="truncate font-medium text-foreground">{e.searchQuery}</p>
                      <p>{e.scored.length} candidates · selected: {e.selectedVideoId}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function booleanToIcon(v: boolean): string {
  return v ? "✅" : "⬜";
}
