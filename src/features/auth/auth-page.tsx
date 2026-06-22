import { useState, useEffect } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { Button } from "../../components/ui/button";
import { buildLocalOrigin } from "../../lib/build-navigation";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { FolderOpen, Loader2 } from "lucide-react";
import type { PlatformService } from "../../services/platform/types";

type AuthForm = {
  folderPath: string;
  downloadFolder: string;
  enableOnlineSearch: boolean;
  musicBrainzToken: string;
  musicBrainzClientId: string;
  musicBrainzClientSecret: string;
  musicBrainzRefreshToken: string;
  musicBrainzTokenExpiresAt: number;
  youtubeMusicHeaders: string;
};

type AuthPageProps = {
  onConnected?: () => void;
};

export function AuthPage({ onConnected }: AuthPageProps) {
  const { addOrigin, setCurrentOrigin } = useAuthStore();
  const [platform, setPlatform] = useState<PlatformService | null>(null);

  const [form, setForm] = useState<AuthForm>({
    folderPath: "",
    downloadFolder: "",
    enableOnlineSearch: false,
    musicBrainzToken: "",
    musicBrainzClientId: "",
    musicBrainzClientSecret: "",
    musicBrainzRefreshToken: "",
    musicBrainzTokenExpiresAt: 0,
    youtubeMusicHeaders: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { getPlatformService } = await import("../../services/platform/factory");
      setPlatform(await getPlatformService());
    })();
  }, []);

  function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      if (!form.folderPath) {
        setError("Please select a music folder");
        setLoading(false);
        return;
      }

      const origin = buildLocalOrigin(form);
      addOrigin(origin);
      setCurrentOrigin(origin);

      import("../../api/indexer/indexer").then(({ getIndexer }) =>
        getIndexer(origin).then((idx) => idx.start(origin))
      );
      onConnected?.();
    } finally {
      setLoading(false);
    }
  }

  async function handleBrowseFolder() {
    if (!platform) return;
    const selected = await platform.openFolderPicker();
    if (selected) {
      setForm({ ...form, folderPath: selected, downloadFolder: selected });
    }
  }

  async function handleBrowseDownload() {
    if (!platform) return;
    const selected = await platform.openFolderPicker();
    if (selected) {
      setForm({ ...form, downloadFolder: selected });
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
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Selftify</CardTitle>
          <CardDescription>Connect your music source</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Music Folder</label>
            <div className="mt-1 flex gap-2">
              <Input
                className="flex-1"
                placeholder="/home/user/Music"
                value={form.folderPath}
                onChange={(e) => setForm({ ...form, folderPath: e.target.value })}
              />
              <Button variant="outline" size="icon" onClick={handleBrowseFolder} title="Browse folder">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Download Folder (default = Music Folder)</label>
            <div className="mt-1 flex gap-2">
              <Input
                className="flex-1"
                placeholder="Same as music folder"
                value={form.downloadFolder}
                onChange={(e) => setForm({ ...form, downloadFolder: e.target.value })}
              />
              <Button variant="outline" size="icon" onClick={handleBrowseDownload} title="Browse download folder">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border p-3">
            <Switch
              id="enable-online"
              checked={form.enableOnlineSearch}
              onCheckedChange={(v) => setForm({ ...form, enableOnlineSearch: v })}
            />
            <label htmlFor="enable-online" className="text-sm font-medium leading-none">
              Enable Online Search
            </label>
          </div>

          {form.enableOnlineSearch && (
            <div className="space-y-4 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Online Search Config</p>

              <div>
                <label className="text-sm font-medium">MusicBrainz Token</label>
                <Input
                  className="mt-1"
                  placeholder="abc-123-def-456 (optional)"
                  value={form.musicBrainzToken}
                  onChange={(e) => setForm({ ...form, musicBrainzToken: e.target.value })}
                />
              </div>

              <div>
                <label className="text-sm font-medium">YouTube Headers</label>
                <Textarea
                  className="mt-1 min-h-[100px] font-mono text-xs"
                  placeholder={"cookie: abc123\nauthorization: SAPISIDHASH...\nuser-agent: Mozilla/5.0..."}
                  value={form.youtubeMusicHeaders}
                  onChange={(e) => setForm({ ...form, youtubeMusicHeaders: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Paste HTTP headers copied from a browser session on music.youtube.com. One header per line (key: value). Cookie is required for yt-dlp downloads.
                </p>
              </div>
            </div>
          )}

          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading ? "Scanning..." : form.enableOnlineSearch ? "Scan Local Files + Enable Online Search" : "Scan Local Files"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
