import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Badge } from "../../components/ui/badge";
import { Slider } from "../../components/ui/slider";
import { Input } from "../../components/ui/input";
import { Loader2, Trash2, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useSettingsStore, type RankingWeights, type KeywordWeight } from "../../stores/settings.store";
import { getRecentRankings, clearRankingLog, clearAllMbzYtMappings, type RankingLogEntry } from "../../services/search-cache";

function ScoreBreakdown({ scores }: { scores: string }) {
  const [open, setOpen] = useState(false);
  let parsed: Record<string, boolean> = {};
  try { parsed = JSON.parse(scores); } catch (err) { console.warn("[ranking-view] JSON parse error:", err); }
  const items = Object.entries(parsed).filter(([k]) => k !== "score");
  return (
    <div>
      <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Details
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {items.map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[10px]">
              <span className="text-muted-foreground">{k}:</span>
              <span>{v ? "✓" : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RankingView() {
  const { rankingWeights, setRankingWeights, addRankingKeyword, removeRankingKeyword, updateRankingKeyword } = useSettingsStore();
  const [rankings, setRankings] = useState<RankingLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [newWeight, setNewWeight] = useState("1.0");

  async function load() {
    setLoading(true);
    setRankings(await getRecentRankings(50));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function setWeight(key: "title" | "artist" | "album" | "duration" | "artistOnChannel", value: number) {
    setRankingWeights({ ...rankingWeights, [key]: Math.round(value * 10) / 10 });
  }

  const weightFields: { key: "title" | "artist" | "album" | "duration" | "artistOnChannel"; label: string; min: number; max: number }[] = [
    { key: "title", label: "Title match", min: 0, max: 2 },
    { key: "artist", label: "Artist match", min: 0, max: 2 },
    { key: "album", label: "Album match", min: 0, max: 2 },
    { key: "duration", label: "Duration match", min: 0, max: 2 },
    { key: "artistOnChannel", label: "Artist on channel", min: 0, max: 2 },
  ];

  function handleAddKeyword() {
    const term = newTerm.trim();
    const weight = parseFloat(newWeight);
    if (!term || isNaN(weight)) return;
    if (rankingWeights.keywords.some((k) => k.term === term)) return;
    addRankingKeyword({ term, weight });
    setNewTerm("");
    setNewWeight("1.0");
  }

  function handleRemoveKeyword(term: string) {
    removeRankingKeyword(term);
  }

  function handleUpdateKeywordWeight(term: string, weight: number) {
    updateRankingKeyword(term, { weight: Math.round(weight * 10) / 10 });
  }

  function handleUpdateKeywordTerm(oldTerm: string, newTerm: string) {
    if (!newTerm.trim() || oldTerm === newTerm) return;
    if (rankingWeights.keywords.some((k) => k.term === newTerm.trim())) return;
    updateRankingKeyword(oldTerm, { term: newTerm.trim() });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ranking Weights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {weightFields.map(({ key, label, min, max }) => (
            <div key={key} className="flex items-center gap-4">
              <span className="w-28 text-sm">{label}</span>
              <Slider
                value={[rankingWeights[key]]}
                min={min}
                max={max}
                step={0.1}
                className="flex-1"
                onValueChange={([v]) => setWeight(key, v)}
              />
              <span className="w-8 text-right text-sm tabular-nums">{rankingWeights[key].toFixed(1)}</span>
            </div>
          ))}

          <div className="border-t pt-4">
            <h4 className="mb-2 text-sm font-medium">Keyword Weights</h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Extra score when video title contains the term (case-insensitive).
            </p>
            <div className="space-y-2">
              {rankingWeights.keywords.map((kw) => (
                <div key={kw.term} className="flex items-center gap-2">
                  <Input
                    value={kw.term}
                    onChange={(e) => handleUpdateKeywordTerm(kw.term, e.target.value)}
                    className="h-8 flex-1 text-sm min-w-[150px]"
                  />
                  <Slider
                    value={[kw.weight]}
                    min={-2}
                    max={2}
                    step={0.1}
                    className="w-24"
                    onValueChange={([v]) => handleUpdateKeywordWeight(kw.term, v)}
                  />
                  <span className="w-8 text-right text-sm tabular-nums">{kw.weight.toFixed(1)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => handleRemoveKeyword(kw.term)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Input
                placeholder="Term (e.g. CD Audio)"
                value={newTerm}
                onChange={(e) => setNewTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddKeyword(); }}
                className="h-8 flex-1 text-sm min-w-[150px]"
              />
              <Slider
                value={[parseFloat(newWeight) || 1.0]}
                min={-2}
                max={2}
                step={0.1}
                className="w-24"
                onValueChange={([v]) => setNewWeight(v.toFixed(1))}
              />
              <span className="w-8 text-right text-sm tabular-nums">
                {(parseFloat(newWeight) || 1.0).toFixed(1)}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={handleAddKeyword}
                disabled={!newTerm.trim() || isNaN(parseFloat(newWeight))}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Cached Mappings</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => { clearAllMbzYtMappings(); }}>
              <Trash2 className="h-3 w-3 mr-1" /> Clear All
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Clears all cached MusicBrainz → YouTube video mappings. Subsequent plays will re-search and re-rank.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recent Ranking Decisions</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => { clearRankingLog(); setRankings([]); }}>
              <Trash2 className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : rankings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No ranking decisions recorded yet.</p>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="space-y-1">
                {rankings.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{r.winnerTitle}</p>
                      <p className="truncate text-muted-foreground">{r.query}</p>
                    </div>
                    <span className="text-muted-foreground shrink-0">{r.winnerUploader}</span>
                    <Badge variant="secondary" className="shrink-0">{r.score.toFixed(1)}</Badge>
                    <Badge variant="outline" className="shrink-0">{r.candidates} candidates</Badge>
                    <ScoreBreakdown scores={r.scores} />
                    <span className="text-muted-foreground shrink-0">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
