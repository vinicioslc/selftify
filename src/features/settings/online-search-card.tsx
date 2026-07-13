import { useState } from "react";
import { useOnlineSearchStore } from "../../stores/online-search.store";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Separator } from "../../components/ui/separator";
import { useStatusStore } from "../../stores/status.store";
import { Globe, Check, Music } from "lucide-react";

export function OnlineSearchCard() {
  const {
    enabled, setEnabled,
    musicBrainzToken,
    youtubeMusicHeaders, downloadFolder,
    updateMusicBrainz, setYoutubeHeaders, setDownloadFolder, clearAuth,
  } = useOnlineSearchStore();

  const [localMbToken, setLocalMbToken] = useState(musicBrainzToken);
  const [localListenBrainzToken, setLocalListenBrainzToken] = useState("");
  const [localYtHeaders, setLocalYtHeaders] = useState(youtubeMusicHeaders);
  const [localDownloadFolder, setLocalDownloadFolder] = useState(downloadFolder);

  const hasToken = Boolean(musicBrainzToken);

  function handleSaveOnline() {
    setEnabled(true);
    updateMusicBrainz({ 
      musicBrainzToken: localMbToken,
      listenBrainzToken: localListenBrainzToken 
    });
    setYoutubeHeaders(localYtHeaders);
    setDownloadFolder(localDownloadFolder);
    useStatusStore.getState().addMessage("Online search config saved", "success", "Settings");
  }

  function handleClearAuth() {
    clearAuth();
    setLocalMbToken("");
    useStatusStore.getState().addMessage("MusicBrainz token cleared", "info", "Settings");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Online Search
        </CardTitle>
        <CardDescription>
          MusicBrainz and YouTube search are available regardless of backend.
          Configure credentials here once — they apply globally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border p-3">
          <Switch
            id="global-online-search"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <label htmlFor="global-online-search" className="text-sm font-medium leading-none">
            Enable MusicBrainz & YouTube search
          </label>
        </div>

        {enabled && (
          <>
            <Separator />

            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-sm font-medium">MusicBrainz</p>

              <div className="space-y-2">
                <label className="text-xs font-medium">Personal Access Token</label>
                <Input
                  value={localMbToken}
                  onChange={(e) => setLocalMbToken(e.target.value)}
                  placeholder="Paste your MusicBrainz token"
                  type="password"
                  className="text-xs"
                />
              </div>

              <div className="flex items-center gap-2">
                {hasToken ? (
                  <div className="flex items-center gap-2 text-xs text-green-500">
                    <Check className="h-3 w-3" />
                    Token saved
                  </div>
                ) : null}
              </div>

              {hasToken && (
                <Button variant="outline" size="sm" onClick={handleClearAuth}>
                  Clear token
                </Button>
              )}

              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium">How to get your token</summary>
                <div className="mt-1 space-y-1 pl-2">
                  <p>1. Go to <a href="https://musicbrainz.org/account/applications" target="_blank" rel="noopener noreferrer" className="underline">musicbrainz.org/account/applications</a></p>
                  <p>2. Click &ldquo;Register new application&rdquo; (or use an existing one)</p>
                  <p>3. After registering, copy the <strong>OAuth Token</strong> (or the token shown for your app)</p>
                  <p>4. Paste it above</p>
                </div>
              </details>
            </div>

            <Separator />

            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-sm font-medium flex items-center gap-2">
                <Music className="h-4 w-4" />
                ListenBrainz Scrobbling
              </p>

              <div className="space-y-2">
                <label className="text-xs font-medium">ListenBrainz User Token</label>
                <Input
                  value={localYtHeaders}
                  onChange={(e) => setLocalYtHeaders(e.target.value)}
                  placeholder="Paste your ListenBrainz user token"
                  type="password"
                  className="text-xs"
                />
              </div>

              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium">How to get your ListenBrainz token</summary>
                <div className="mt-1 space-y-1 pl-2">
                  <p>1. Go to <a href="https://listenbrainz.org" target="_blank" rel="noopener noreferrer" className="underline">listenbrainz.org</a></p>
                  <p>2. Create an account or log in</p>
                  <p>3. Go to <a href="https://listenbrainz.org/settings" target="_blank" rel="noopener noreferrer" className="underline">Settings → API Token</a></p>
                  <p>4. Generate a new token and paste it above</p>
                </div>
              </details>
            </div>

            <Separator />

            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium">YouTube Headers</p>
              <Textarea
                className="min-h-[80px] font-mono text-xs"
                placeholder={"cookie: abc123\nauthorization: SAPISIDHASH...\nuser-agent: Mozilla/5.0..."}
                value={localYtHeaders}
                onChange={(e) => setLocalYtHeaders(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Paste HTTP headers from a browser session on music.youtube.com. One per line (key: value).
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Download Folder</label>
              <Input
                value={localDownloadFolder}
                onChange={(e) => setLocalDownloadFolder(e.target.value)}
                placeholder="/home/user/Music/selftify-downloads"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Where downloaded songs are saved. Defaults to the origin's music folder if not set.
              </p>
            </div>

            <Button onClick={handleSaveOnline} className="w-full">
              Save Online Search Config
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}