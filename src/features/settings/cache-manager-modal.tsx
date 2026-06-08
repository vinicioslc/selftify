import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Trash2, Loader2 } from "lucide-react";
import { getAllSearchCacheEntries, deleteSearchCache, clearSearchCache, getAllMbzYtMappings, deleteMbzYtMapping, clearAllMbzYtMappings, type CacheEntry, type MbzYtMapping } from "../../services/search-cache";

export function CacheManagerModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [searchEntries, setSearchEntries] = useState<CacheEntry[]>([]);
  const [mappings, setMappings] = useState<MbzYtMapping[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const [se, mp] = await Promise.all([getAllSearchCacheEntries(), getAllMbzYtMappings()]);
    setSearchEntries(se);
    setMappings(mp);
    setLoading(false);
  }

  useEffect(() => { if (open) refresh(); }, [open]);

  const grouped = searchEntries.reduce<Record<string, CacheEntry[]>>((acc, e) => {
    const key = e.provider === "musicbrainz" || e.provider === "youtube-pure" ? "online" : e.provider;
    (acc[key] ??= []).push(e);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Search Cache Manager</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="searches">
          <TabsList>
            <TabsTrigger value="searches">Search Results</TabsTrigger>
            <TabsTrigger value="mappings">MB→YT Mappings ({mappings.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="searches">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : searchEntries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No cached queries.</p>
            ) : (
              <ScrollArea className="max-h-[50vh]">
                {["online", "local"].map((provider) => {
                  const entries = grouped[provider];
                  if (!entries?.length) return null;
                  return (
                    <div key={provider} className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium capitalize">{provider} ({entries.length})</h4>
                        <Button variant="ghost" size="sm" onClick={() => {
                          if (provider === "online") {
                            clearSearchCache("musicbrainz");
                            clearSearchCache("youtube-pure");
                          } else {
                            clearSearchCache(provider);
                          }
                          refresh();
                        }}>
                          Clear All
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {entries.map((e) => {
                          const songCount = JSON.parse(e.songs || "[]").length;
                          return (
                            <div key={e.key} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 text-xs">
                              <span className="truncate flex-1">{e.query}</span>
                              <Badge variant="outline" className="mx-2 shrink-0">{songCount} songs</Badge>
                              <span className="text-muted-foreground shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
                              <Button variant="ghost" size="icon" className="h-6 w-6 ml-2 shrink-0"
                                onClick={() => { deleteSearchCache(e.key); refresh(); }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="mappings">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : mappings.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No MB→YT mappings saved yet.</p>
            ) : (
              <ScrollArea className="max-h-[50vh]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Total: {mappings.length} mappings</span>
                  <Button variant="ghost" size="sm" onClick={() => { clearAllMbzYtMappings(); refresh(); }}>
                    Clear All
                  </Button>
                </div>
                <div className="space-y-1">
                  {mappings.map((m) => {
                    const first = m.candidates ? (JSON.parse(m.candidates) as any[])?.[0] : null;
                    return (
                    <div key={m.mbzRecordingId} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 text-xs">
                      <span className="truncate flex-1">{first?.title || m.songName || m.selectedVideoId}</span>
                      <span className="text-muted-foreground mx-2 shrink-0">{first?.uploader || '—'}</span>
                      <Badge variant="outline" className="mx-1 shrink-0">{m.selectedType}</Badge>
                      <span className="text-muted-foreground shrink-0">{new Date(m.updatedAt).toLocaleString()}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 ml-2 shrink-0"
                        onClick={() => { deleteMbzYtMapping(m.mbzRecordingId); refresh(); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    )})}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
