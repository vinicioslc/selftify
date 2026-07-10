import { useState } from "react";
import { useOnlineSearchStore } from "../../stores/online-search.store";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Separator } from "../../components/ui/separator";
import { useStatusStore } from "../../stores/status.store";
import { Globe, Check, LogIn, RefreshCw } from "lucide-react";
import {
  buildAuthorizeUrlOob,
  exchangeCode,
  isTokenExpired,
  computeExpiresAt,
} from "../../services/musicbrainz-oauth";

export function OnlineSearchCard() {
  const {
    enabled, setEnabled,
    musicBrainzClientId, musicBrainzClientSecret,
    musicBrainzToken, musicBrainzRefreshToken, musicBrainzTokenExpiresAt,
    youtubeMusicHeaders, downloadFolder,
    updateMusicBrainz, setYoutubeHeaders, setDownloadFolder, clearAuth,
  } = useOnlineSearchStore();

  const [localClientId, setLocalClientId] = useState(musicBrainzClientId);
  const [localClientSecret, setLocalClientSecret] = useState(musicBrainzClientSecret);
  const [localYtHeaders, setLocalYtHeaders] = useState(youtubeMusicHeaders);
  const [localDownloadFolder, setLocalDownloadFolder] = useState(downloadFolder);
  const [authLoading, setAuthLoading] = useState(false);
  const [oobCode, setOobCode] = useState("");
  const [showOobInput, setShowOobInput] = useState(false);

  const hasValidToken = musicBrainzToken && musicBrainzRefreshToken && !isTokenExpired(musicBrainzTokenExpiresAt);
  const tokenExpired = musicBrainzToken && musicBrainzTokenExpiresAt && isTokenExpired(musicBrainzTokenExpiresAt);

  function handleSaveOnline() {
    setEnabled(true);
    updateMusicBrainz({
      musicBrainzClientId: localClientId,
      musicBrainzClientSecret: localClientSecret,
    });
    setYoutubeHeaders(localYtHeaders);
    setDownloadFolder(localDownloadFolder);
    useStatusStore.getState().addMessage("Online search config saved", "success", "Settings");
  }

  async function handleLoginWithMusicBrainz() {
    const clientId = localClientId.trim();
    const clientSecret = localClientSecret.trim();
    if (!clientId || !clientSecret) {
      useStatusStore.getState().addMessage("Enter Client ID and Client Secret first", "warn", "Settings");
      return;
    }

    setAuthLoading(true);
    try {
      const api = (window as any).electronApi;
      if (api?.musicbrainzOAuth) {
        const result = await api.musicbrainzOAuth.authorize(clientId);
        if (!result) {
          useStatusStore.getState().addMessage("MusicBrainz authorization cancelled", "warn", "Settings");
          return;
        }
        const { code, redirectUri } = result as { code: string; redirectUri: string };
        const tokenResp = await exchangeCode(clientId, clientSecret, code, redirectUri);
        const expiresAt = computeExpiresAt(tokenResp.expires_in);
        updateMusicBrainz({
          musicBrainzToken: tokenResp.access_token,
          musicBrainzRefreshToken: tokenResp.refresh_token,
          musicBrainzTokenExpiresAt: expiresAt,
        });
        useStatusStore.getState().addMessage("MusicBrainz login successful!", "success", "Settings");
      } else {
        const authUrl = buildAuthorizeUrlOob(clientId);
        window.open(authUrl, "_blank");
        setShowOobInput(true);
      }
    } catch (err: any) {
      console.error("[mb-oauth] authorize failed:", err);
      useStatusStore.getState().addMessage(`MusicBrainz login failed: ${err.message}`, "danger", "Settings");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSubmitOobCode() {
    const code = oobCode.trim();
    if (!code) return;
    const clientId = localClientId.trim();
    const clientSecret = localClientSecret.trim();
    if (!clientId || !clientSecret) return;

    setAuthLoading(true);
    try {
      const tokenResp = await exchangeCode(clientId, clientSecret, code, "urn:ietf:wg:oauth:2.0:oob");
      const expiresAt = computeExpiresAt(tokenResp.expires_in);
      updateMusicBrainz({
        musicBrainzToken: tokenResp.access_token,
        musicBrainzRefreshToken: tokenResp.refresh_token,
        musicBrainzTokenExpiresAt: expiresAt,
      });
      setShowOobInput(false);
      setOobCode("");
      useStatusStore.getState().addMessage("MusicBrainz login successful!", "success", "Settings");
    } catch (err: any) {
      console.error("[mb-oauth] OOB exchange failed:", err);
      useStatusStore.getState().addMessage(`MusicBrainz login failed: ${err.message}`, "danger", "Settings");
    } finally {
      setAuthLoading(false);
    }
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
                <label className="text-xs font-medium">Client ID</label>
                <Input
                  value={localClientId}
                  onChange={(e) => setLocalClientId(e.target.value)}
                  placeholder="Paste your MusicBrainz Client ID"
                  className="text-xs"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium">Client Secret</label>
                <Input
                  type="password"
                  value={localClientSecret}
                  onChange={(e) => setLocalClientSecret(e.target.value)}
                  placeholder="Paste your MusicBrainz Client Secret"
                  className="text-xs"
                />
              </div>

              <div className="flex flex-col gap-2">
                {hasValidToken ? (
                  <div className="flex items-center gap-2 text-xs text-green-500">
                    <Check className="h-3 w-3" />
                    Authenticated
                    {musicBrainzTokenExpiresAt ? (
                      <span className="text-muted-foreground">
                        (expires {new Date(musicBrainzTokenExpiresAt).toLocaleTimeString()})
                      </span>
                    ) : null}
                  </div>
                ) : tokenExpired ? (
                  <p className="text-xs text-amber-500">Token expired — re-authenticate</p>
                ) : null}

                <Button
                  variant={hasValidToken ? "outline" : "default"}
                  size="sm"
                  onClick={handleLoginWithMusicBrainz}
                  disabled={authLoading}
                  className="gap-2"
                >
                  {authLoading ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <LogIn className="h-3 w-3" />
                  )}
                  {authLoading
                    ? "Authorizing..."
                    : hasValidToken
                      ? "Re-authenticate"
                      : "Login with MusicBrainz"}
                </Button>
              </div>

              {showOobInput && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Paste the authorization code
                  </p>
                  <p className="text-xs text-muted-foreground">
                    A new tab opened. Authorize the app, then copy the code and paste it here.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={oobCode}
                      onChange={(e) => setOobCode(e.target.value)}
                      placeholder="Paste code here"
                      className="text-xs"
                    />
                    <Button size="sm" onClick={handleSubmitOobCode} disabled={authLoading || !oobCode.trim()}>
                      {authLoading ? "Verifying..." : "Submit"}
                    </Button>
                  </div>
                </div>
              )}

              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium">How to get Client ID &amp; Secret</summary>
                <div className="mt-1 space-y-1 pl-2">
                  <p>1. Go to <a href="https://musicbrainz.org/account/applications" target="_blank" rel="noopener noreferrer" className="underline">musicbrainz.org/account/applications</a></p>
                  <p>2. Click &ldquo;Register new application&rdquo;</p>
                  <p>3. Name: <code>Selftify</code> (any name works)</p>
                  <p>4. Type: <strong>Public</strong> (desktop app)</p>
                  <p>5. Redirect URIs (Electron): <code>http://localhost:5678</code></p>
                  <p>6. Redirect URI (OOB fallback): <code>urn:ietf:wg:oauth:2.0:oob</code></p>
                  <p>7. Copy the Client ID and Secret into the fields above</p>
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
