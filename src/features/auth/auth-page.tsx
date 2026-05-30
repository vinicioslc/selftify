import { useState, useEffect } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { OriginType } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Music, Tv2, Youtube, FolderOpen, Loader2 } from "lucide-react";
import type { PlatformService } from "../../services/platform/types";

type AuthForm = {
  url: string;
  username: string;
  password: string;
  cookies: string;
  folder: string;
};

type AuthPageProps = {
  onConnected?: () => void;
};

export function AuthPage({ onConnected }: AuthPageProps) {
  const { addOrigin, setCurrentOrigin } = useAuthStore();
  const [platform, setPlatform] = useState<PlatformService | null>(null);
  const [form, setForm] = useState<AuthForm>({
    url: "",
    username: "",
    password: "",
    cookies: "",
    folder: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { getPlatformService } = await import("../../services/platform/factory");
      setPlatform(await getPlatformService());
    })();
  }, []);

  async function handleNavidromeAuth() {
    setLoading(true);
    setError(null);
    try {
      const originId = crypto.randomUUID();
      const origin = {
        id: originId,
        name: `Navidrome (${form.url})`,
        type: OriginType.NAVIDROME,
        url: form.url,
        credential: form.password,
      };
      addOrigin(origin);
      setCurrentOrigin(origin);
      onConnected?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleJellyfinAuth() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${form.url.replace(/\/+$/, "")}/Users/AuthenticateByName`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `MediaBrowser Client="YTMusicPlayer", Device="Web", DeviceId="web", Version="1.0.0"`,
        },
        body: JSON.stringify({ Username: form.username, Pw: form.password }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.Message || "Authentication failed");
      const jfServerId = crypto.randomUUID();
      const jfServer = {
        id: jfServerId,
        name: `Jellyfin (${form.url})`,
        type: OriginType.JELLYFIN,
        url: form.url,
        credential: data.AccessToken,
      };
      addOrigin(jfServer);
      setCurrentOrigin(jfServer);
      onConnected?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleYouTubeAuth() {
    setLoading(true);
    setError(null);
    try {
      const { authenticateWithCookies } = await import("../../api/youtube/youtube-api");
      const result = await authenticateWithCookies(form.cookies);
      const ytServerId = crypto.randomUUID();
      const ytServer = {
        id: ytServerId,
        name: result.username,
        type: OriginType.YOUTUBE_MUSIC,
        credential: result.cookie,
      };
      addOrigin(ytServer);
      setCurrentOrigin(ytServer);
      onConnected?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLocalAuth() {
    const localId = crypto.randomUUID();
    const localServer = {
      id: localId,
      name: form.folder || "Local Files",
      type: OriginType.LOCAL,
      url: form.folder || undefined,
    };
    addOrigin(localServer);
    setCurrentOrigin(localServer);
    if (form.folder) {
      import("../../api/indexer/indexer").then(({ getIndexer }) =>
        getIndexer(localServer).then((idx) => idx.start(localServer))
      );
    }
    onConnected?.();
  }

  async function handleBrowseFolder() {
    if (!platform) return;
    const selected = await platform.openFolderPicker();
    if (selected) {
      setForm({ ...form, folder: selected });
    }
  }

  if (!platform) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">YT Music Player</CardTitle>
          <CardDescription>Connect to your music source</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={platform.isElectron ? "local" : "navidrome"}>
            <TabsList className="mb-4 grid w-full grid-cols-4">
              <TabsTrigger value="navidrome"><Music className="mr-1 h-3 w-3" /> Nav</TabsTrigger>
              <TabsTrigger value="jellyfin"><Tv2 className="mr-1 h-3 w-3" /> JF</TabsTrigger>
              <TabsTrigger value="youtube"><Youtube className="mr-1 h-3 w-3" /> YT</TabsTrigger>
              <TabsTrigger value="local"><FolderOpen className="mr-1 h-3 w-3" /> Local</TabsTrigger>
            </TabsList>

            {/* Navidrome */}
            <TabsContent value="navidrome" className="space-y-4">
              <Input
                placeholder="Server URL (e.g. http://192.168.1.100:4533)"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
              <Input
                placeholder="Password / Token"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <Button className="w-full" onClick={handleNavidromeAuth} disabled={loading}>
                {loading ? "Connecting..." : "Connect to Navidrome"}
              </Button>
            </TabsContent>

            {/* Jellyfin */}
            <TabsContent value="jellyfin" className="space-y-4">
              <Input
                placeholder="Server URL (e.g. http://192.168.1.100:8096)"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
              <Input
                placeholder="Username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
              <Input
                placeholder="Password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <Button className="w-full" onClick={handleJellyfinAuth} disabled={loading}>
                {loading ? "Connecting..." : "Connect to Jellyfin"}
              </Button>
            </TabsContent>

            {/* YouTube Music */}
            <TabsContent value="youtube" className="space-y-4">
              <Input
                placeholder="YouTube Music cookies (Netscape format)"
                value={form.cookies}
                onChange={(e) => setForm({ ...form, cookies: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Export cookies from your browser while logged into YouTube Music.
              </p>
              <Button className="w-full" onClick={handleYouTubeAuth} disabled={loading}>
                {loading ? "Authenticating..." : "Connect YouTube Music"}
              </Button>
            </TabsContent>

            {/* Local Files */}
            <TabsContent value="local" className="space-y-4">
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="Music folder path"
                  value={form.folder}
                  onChange={(e) => setForm({ ...form, folder: e.target.value })}
                />
                <Button variant="outline" size="icon" onClick={handleBrowseFolder} title="Browse folder">
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              {!platform?.isElectron && (
                <p className="text-xs text-muted-foreground">
                  On Android, use paths like /storage/emulated/0/Music
                </p>
              )}
              {platform?.isElectron && (
                <p className="text-xs text-muted-foreground">
                  Select a local folder to scan for music files
                </p>
              )}
              <Button className="w-full" onClick={handleLocalAuth}>
                Scan Local Files
              </Button>
            </TabsContent>
          </Tabs>

          {error && (
            <p className="mt-4 text-center text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
