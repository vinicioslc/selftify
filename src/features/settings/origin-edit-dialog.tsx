import { useState } from "react";
import { Origin, OriginType } from "../../types/domain-types";
import { useAuthStore } from "../../stores/auth.store";
import { useStatusStore } from "../../stores/status.store";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../components/ui/dialog";
import {
  buildAuthorizeUrlOob,
  exchangeCode,
  isTokenExpired,
  computeExpiresAt,
} from "../../services/musicbrainz-oauth";
import { Check, LogIn, RefreshCw } from "lucide-react";

type OriginEditDialogProps = {
  origin: Origin;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OriginEditDialog({ origin, open, onOpenChange }: OriginEditDialogProps) {
  const updateOrigin = useAuthStore((s) => s.updateOrigin);
  const [form, setForm] = useState({
    name: origin.name,
    folderPath: origin.folderPath || "",
    downloadFolder: origin.downloadFolder || "",
    enableOnlineSearch: origin.enableOnlineSearch || false,
    musicBrainzToken: origin.musicBrainzToken || "",
    musicBrainzClientId: origin.musicBrainzClientId || "",
    musicBrainzClientSecret: origin.musicBrainzClientSecret || "",
    musicBrainzRefreshToken: origin.musicBrainzRefreshToken || "",
    musicBrainzTokenExpiresAt: origin.musicBrainzTokenExpiresAt || 0,
    youtubeMusicHeaders: origin.youtubeMusicHeaders || "",
  });
  const [authLoading, setAuthLoading] = useState(false);
  const [oobCode, setOobCode] = useState("");
  const [showOobInput, setShowOobInput] = useState(false);

  function handleSave() {
    updateOrigin(origin.id, {
      name: form.name,
      folderPath: form.folderPath || undefined,
      downloadFolder: form.downloadFolder || undefined,
      enableOnlineSearch: form.enableOnlineSearch,
      musicBrainzToken: form.musicBrainzToken || undefined,
      musicBrainzClientId: form.musicBrainzClientId || undefined,
      musicBrainzClientSecret: form.musicBrainzClientSecret || undefined,
      musicBrainzRefreshToken: form.musicBrainzRefreshToken || undefined,
      musicBrainzTokenExpiresAt: form.musicBrainzTokenExpiresAt || undefined,
      youtubeMusicHeaders: form.youtubeMusicHeaders || undefined,
    });
    onOpenChange(false);
  }

  async function handleLoginWithMusicBrainz() {
    const clientId = form.musicBrainzClientId.trim();
    const clientSecret = form.musicBrainzClientSecret.trim();
    if (!clientId || !clientSecret) {
      useStatusStore.getState().addMessage("Enter Client ID and Client Secret first", "warn", "Settings");
      return;
    }

    setAuthLoading(true);
    try {
      const api = (window as any).electronApi;
      if (api?.musicbrainzOAuth) {
        // ── Electron flow: automatic via localhost HTTP server ──
        const result = await api.musicbrainzOAuth.authorize(clientId);
        if (!result) {
          useStatusStore.getState().addMessage("MusicBrainz authorization cancelled", "warn", "Settings");
          return;
        }
        const { code, redirectUri } = result as { code: string; redirectUri: string };
        const tokenResp = await exchangeCode(clientId, clientSecret, code, redirectUri);
        const expiresAt = computeExpiresAt(tokenResp.expires_in);
        setForm({
          ...form,
          musicBrainzToken: tokenResp.access_token,
          musicBrainzRefreshToken: tokenResp.refresh_token,
          musicBrainzTokenExpiresAt: expiresAt,
        });
        useStatusStore.getState().addMessage("MusicBrainz login successful!", "success", "Settings");
      } else {
        // ── Web flow: OOB — open authorize page, ask user to paste code ──
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
    const clientId = form.musicBrainzClientId.trim();
    const clientSecret = form.musicBrainzClientSecret.trim();
    if (!clientId || !clientSecret) return;

    setAuthLoading(true);
    try {
      const tokenResp = await exchangeCode(clientId, clientSecret, code, "urn:ietf:wg:oauth:2.0:oob");
      const expiresAt = computeExpiresAt(tokenResp.expires_in);
      setForm({
        ...form,
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

  const hasValidToken = form.musicBrainzToken && form.musicBrainzRefreshToken && !isTokenExpired(form.musicBrainzTokenExpiresAt);
  const tokenExpired = form.musicBrainzToken && form.musicBrainzTokenExpiresAt && isTokenExpired(form.musicBrainzTokenExpiresAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Source</DialogTitle>
          <DialogDescription>
            Update the configuration for &ldquo;{origin.name}&rdquo;
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Music Folder</label>
            <Input
              value={form.folderPath}
              onChange={(e) => setForm({ ...form, folderPath: e.target.value })}
              placeholder="/home/user/Music"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Download Folder</label>
            <Input
              value={form.downloadFolder}
              onChange={(e) => setForm({ ...form, downloadFolder: e.target.value })}
              placeholder="Same as music folder"
            />
          </div>

          <div className="flex items-center gap-2 rounded-lg border p-3">
            <Switch
              id="edit-enable-online"
              checked={form.enableOnlineSearch}
              onCheckedChange={(v) => setForm({ ...form, enableOnlineSearch: v })}
            />
            <label htmlFor="edit-enable-online" className="text-sm font-medium leading-none">
              Enable Online Search
            </label>
          </div>

          {form.enableOnlineSearch && (
            <div className="space-y-4 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Online Search Config</p>

              {/* ── MusicBrainz OAuth ── */}
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium">MusicBrainz Authentication</p>

                <div className="space-y-2">
                  <label className="text-xs font-medium">Client ID</label>
                  <Input
                    value={form.musicBrainzClientId}
                    onChange={(e) => setForm({ ...form, musicBrainzClientId: e.target.value })}
                    placeholder="Paste your MusicBrainz Client ID"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium">Client Secret</label>
                  <Input
                    type="password"
                    value={form.musicBrainzClientSecret}
                    onChange={(e) => setForm({ ...form, musicBrainzClientSecret: e.target.value })}
                    placeholder="Paste your MusicBrainz Client Secret"
                    className="text-xs"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  {hasValidToken ? (
                    <div className="flex items-center gap-2 text-xs text-green-500">
                      <Check className="h-3 w-3" />
                      Authenticated
                      {form.musicBrainzTokenExpiresAt && (
                        <span className="text-muted-foreground">
                          (expires {new Date(form.musicBrainzTokenExpiresAt).toLocaleTimeString()})
                        </span>
                      )}
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

                  {form.musicBrainzToken && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Access Token (read-only)</label>
                      <Input
                        value={form.musicBrainzToken}
                        onChange={(e) => setForm({ ...form, musicBrainzToken: e.target.value })}
                        placeholder="Auto-filled after login"
                        className="text-xs"
                      />
                    </div>
                  )}
                </div>

                {showOobInput && (
                  <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
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
              </div>

              {/* ── Register app hint ── */}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium">How to get Client ID &amp; Secret</summary>
                <div className="mt-1 space-y-1 pl-2">
                  <p>1. Go to <a href="https://musicbrainz.org/account/applications" target="_blank" rel="noopener noreferrer" className="underline">musicbrainz.org/account/applications</a></p>
                  <p>2. Click &ldquo;Register new application&rdquo;</p>
                  <p>3. Name: <code>Selftify</code> (any name works)</p>
                  <p>4. Type: <strong>Public</strong> (desktop app)</p>
                  <p>5. Redirect URIs (Electron): <code>http://localhost:5678</code> (dynamic port)</p>
                  <p>6. Redirect URI (OOB fallback): <code>urn:ietf:wg:oauth:2.0:oob</code></p>
                  <p>7. Copy the Client ID and Client Secret into the fields above</p>
                </div>
              </details>

              {/* ── Existing token field ── */}
              <div className="space-y-2">
                <label className="text-sm font-medium">MusicBrainz Token (legacy)</label>
                <Input
                  value={form.musicBrainzToken}
                  onChange={(e) => setForm({ ...form, musicBrainzToken: e.target.value })}
                  placeholder="abc-123-def-456 (optional)"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">YouTube Headers</label>
                <Textarea
                  className="min-h-[80px] font-mono text-xs"
                  placeholder={"cookie: abc123\nauthorization: SAPISIDHASH..."}
                  value={form.youtubeMusicHeaders}
                  onChange={(e) => setForm({ ...form, youtubeMusicHeaders: e.target.value })}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
