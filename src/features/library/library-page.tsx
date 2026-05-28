import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";
import { ServerType } from "../../types/domain-types";

type LibraryPageProps = {
  onNavigate?: (view: any) => void;
};

export function LibraryPage(_props?: LibraryPageProps) {
  const { currentServer } = useAuthStore();
  const { currentTrack, setQueue, queue } = usePlayerStore();

  if (!currentServer) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Select a server to browse your library</p>
      </div>
    );
  }

  const displayServerType = currentServer.type === ServerType.SUBISONIC
    ? ServerType.NAVIDROME
    : currentServer.type;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <h1 className="text-2xl font-bold">Music Library</h1>
        <p className="text-sm text-muted-foreground">
          Browsing: {currentServer.name} ({displayServerType})
        </p>
      </div>

      <ScrollArea className="flex-1 p-6">
        <div className="mx-auto max-w-4xl">
          {/* Quick stats */}
          <div className="mb-8 grid grid-cols-3 gap-4">
            <div className="rounded-lg border p-4">
              <p className="text-2xl font-bold">{queue.length}</p>
              <p className="text-sm text-muted-foreground">Queue</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-2xl font-bold">{currentTrack ? "1" : "0"}</p>
              <p className="text-sm text-muted-foreground">Playing</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-2xl font-bold">{displayServerType}</p>
              <p className="text-sm text-muted-foreground">Server Type</p>
            </div>
          </div>

          <Separator className="my-6" />

          {/* Server-specific info */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Browse</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Button
                variant="outline"
                className="h-24 flex-col items-start justify-center gap-1 p-4"
              >
                <span className="text-lg font-semibold">Albums</span>
                <span className="text-xs text-muted-foreground">Browse all albums</span>
              </Button>
              <Button
                variant="outline"
                className="h-24 flex-col items-start justify-center gap-1 p-4"
              >
                <span className="text-lg font-semibold">Artists</span>
                <span className="text-xs text-muted-foreground">Browse all artists</span>
              </Button>
              <Button
                variant="outline"
                className="h-24 flex-col items-start justify-center gap-1 p-4"
              >
                <span className="text-lg font-semibold">Songs</span>
                <span className="text-xs text-muted-foreground">All songs</span>
              </Button>
              <Button
                variant="outline"
                className="h-24 flex-col items-start justify-center gap-1 p-4"
              >
                <span className="text-lg font-semibold">Playlists</span>
                <span className="text-xs text-muted-foreground">Your playlists</span>
              </Button>
              <Button
                variant="outline"
                className="h-24 flex-col items-start justify-center gap-1 p-4"
              >
                <span className="text-lg font-semibold">Genres</span>
                <span className="text-xs text-muted-foreground">By genre</span>
              </Button>
              <Button
                variant="outline"
                className="h-24 flex-col items-start justify-center gap-1 p-4"
              >
                <span className="text-lg font-semibold">Recently Added</span>
                <span className="text-xs text-muted-foreground">Newest music</span>
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
