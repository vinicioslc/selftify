import { useState, useEffect } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { Button } from "../../components/ui/button";
import { buildLocalOrigin } from "../../lib/build-navigation";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { FolderOpen, Loader2 } from "lucide-react";
import type { PlatformService } from "../../services/platform/types";

type AuthForm = {
  folderPath: string;
  downloadFolder: string;
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

          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading ? "Scanning..." : "Scan Local Files"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
