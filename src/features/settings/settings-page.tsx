import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore, VisualizerType, type YtSearchFields } from "../../stores/settings.store";
import { useBackendStore } from "../../stores/backend.store";
import { buildLocalOrigin } from "../../lib/build-navigation";
import { Origin } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Slider } from "../../components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { Separator } from "../../components/ui/separator";
import { useState, useEffect, useCallback, useRef } from "react";
import { Trash2, Volume2, Check, FolderOpen, Pencil, Database, RefreshCw, Download } from "lucide-react";
import { AudioOutputManager } from "../../services/audio-output/audio-output-manager";
import type { AudioDevice } from "../../services/audio-output/audio-output-strategy";
import { OriginEditDialog } from "./origin-edit-dialog";
import { OnlineSearchCard } from "./online-search-card";
import { CacheManagerModal } from "./cache-manager-modal";
import { RankingView } from "./ranking-view";
import { useStatusStore } from "../../stores/status.store";
import { LibraryBrowserDialog } from "./library-browser-dialog";

const PROVIDER_META: Record<string, { label: string; description: string; domain: string }> = {
  embedded: { label: "Embedded Tags", description: "Cover art extracted from file tags", domain: "local" },
  cover_art_archive: { label: "Cover Art Archive", description: "Official covers indexed by MusicBrainz", domain: "coverartarchive.org" },
  musicbrainz_release_group: { label: "MusicBrainz RG", description: "Release group → releases → CAA", domain: "musicbrainz.org" },
  itunes: { label: "iTunes Search", description: "Apple Music / iTunes Store album art", domain: "itunes.apple.com" },
  deezer: { label: "Deezer", description: "Deezer album covers", domain: "api.deezer.com" },
};

const YT_SEARCH_FIELD_META: { key: keyof YtSearchFields; label: string; description: string }[] = [
  { key: "artistName", label: "Artist Name", description: "e.g. Metallica" },
  { key: "songName", label: "Song Title", description: "e.g. Enter Sandman" },
  { key: "albumName", label: "Album Name", description: "e.g. Metallica" },
  { key: "releaseYear", label: "Release Year", description: "e.g. 1991 — helps disambiguate albums with the same name" },
  { key: "genres", label: "Genre", description: "e.g. Thrash Metal — first genre tag from MusicBrainz" },
];

function buildSearchPreview(fields: YtSearchFields): string {
  const demo: Record<string, string | undefined> = {
    artistName: "Metallica",
    songName: "Enter Sandman",
    albumName: "Metallica",
    releaseYear: "1991",
    genres: "Thrash Metal",
  };
  const parts: string[] = [];
  for (const { key } of YT_SEARCH_FIELD_META) {
    if (fields[key]) {
      const val = demo[key];
      if (val) parts.push(val);
    }
  }
  return parts.join(" — ") || "";
}

const COVER_PRIORITY_OPTIONS: { value: "filesystem" | "embedded"; label: string; description: string }[] = [
  {
    value: "filesystem",
    label: "File system (.img/ folder)",
    description: "Prefer cover images from the .img/ folder inside each album directory. Falls back to embedded MP3 cover art if not found.",
  },
  {
    value: "embedded",
    label: "Embedded (MP3 tags)",
    description: "Prefer cover art extracted from audio file metadata tags. Falls back to .img/ folder if not found.",
  },
];

type SettingsPageProps = {
  initialTab?: string;
};

export function SettingsPage({ initialTab }: SettingsPageProps) {
  const { origins, addOrigin, setCurrentOrigin } = useAuthStore();
  const {
    theme, setTheme,
    visualizerType, setVisualizerType,
    visualizerEnabled, setVisualizerEnabled,
    crossfadeEnabled, setCrossfadeEnabled,
    fadeInDuration, setFadeInDuration,
    fadeOutDuration, setFadeOutDuration,
    sidebarCollapsed,
    animationsEnabled, setAnimationsEnabled,
    activeAudioOutputs, setActiveAudioOutputs,
    autoSwitchOutput, setAutoSwitchOutput,
    imageFetchTimeoutMs, setImageFetchTimeoutMs,
    searchTimeoutMs, setSearchTimeoutMs,
    streamTimeoutMs, setStreamTimeoutMs,
    cacheTtlMinutes, setCacheTtlMinutes,
    ytSearchFields, setYtSearchFields,
    coverPriority, setCoverPriority,
    artworkProviders, isArtworkProviderEnabled, getArtworkPaceMs, setArtworkProvider,
  } = useSettingsStore();

  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const audioManagerRef = useState(() => new AudioOutputManager())[0];

  useEffect(() => {
    audioManagerRef.init().then(() => {
      setAudioDevices(audioManagerRef.devices);
    });
    const unsub = audioManagerRef.onDeviceChange(() => {
      audioManagerRef.refreshDevices().then(setAudioDevices);
    });
    audioManagerRef.startPolling(3000);
    return () => {
      unsub();
      audioManagerRef.stopPolling();
    };
  }, [audioManagerRef]);

  const [editingOrigin, setEditingOrigin] = useState<Origin | null>(null);
  const [cacheModalOpen, setCacheModalOpen] = useState(false);
  const [clearingImageCache, setClearingImageCache] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [syncingMetadata, setSyncingMetadata] = useState(false);
  const [ytDlpVersion, setYtDlpVersion] = useState<string | null>(null);
  const [ytDlpFound, setYtDlpFound] = useState(false);
  const [checkingYtDlp, setCheckingYtDlp] = useState(false);
  const [updatingYtDlp, setUpdatingYtDlp] = useState(false);
  const [ytDlpUpdateMsg, setYtDlpUpdateMsg] = useState<string | null>(null);

  // Server config
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:6189";
  const [serverLibraryRoot, setServerLibraryRoot] = useState("");
  const [serverDbReady, setServerDbReady] = useState(false);
  const [serverConfigLoading, setServerConfigLoading] = useState(false);
  const [serverConfigSaving, setServerConfigSaving] = useState(false);
  const [serverScanStatus, setServerScanStatus] = useState<{ status: string; progress: { total: number; done: number; currentItem: string } } | null>(null);
  const [serverScanning, setServerScanning] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const prevScanStatusRef = useRef<string | undefined>(undefined);

  const fetchServerConfig = useCallback(async () => {
    setServerConfigLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/selftify/config`);
      if (!res.ok) return;
      const data = await res.json();
      setServerLibraryRoot(data.libraryRoot || "");
      setServerDbReady(data.dbReady || false);
    } catch { /* server not reachable */ }
    setServerConfigLoading(false);
  }, [API_BASE]);

  const fetchServerScanStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/selftify/scan/status`);
      if (!res.ok) return;
      const data = await res.json();
      setServerScanStatus(data);
      setServerScanning(data.status === "discovering" || data.status === "indexing");
      // Notify other views (e.g. Home) to refresh once a scan finishes.
      if (data.status === "done" && prevScanStatusRef.current !== "done") {
        window.dispatchEvent(new Event("selftify:library-updated"));
      }
      prevScanStatusRef.current = data.status;
    } catch { /* server not reachable */ }
  }, [API_BASE]);

  useEffect(() => {
    fetchServerConfig();
  }, [fetchServerConfig]);

  useEffect(() => {
    if (!serverScanning) return;
    const interval = setInterval(fetchServerScanStatus, 1000);
    return () => clearInterval(interval);
  }, [serverScanning, fetchServerScanStatus]);

  async function handleSaveServerConfig() {
    setServerConfigSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/selftify/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryRoot: serverLibraryRoot }),
      });
      if (res.ok) {
        const data = await res.json();
        setServerDbReady(data.dbReady || false);
        useStatusStore.getState().addMessage("Server library root updated", "success", "Settings");
      }
    } catch {
      useStatusStore.getState().addMessage("Failed to update server config", "danger", "Settings");
    }
    setServerConfigSaving(false);
  }

  async function handleStartScan() {
    if (serverScanStatus?.status === "discovering" || serverScanStatus?.status === "indexing") {
      useStatusStore.getState().addMessage("Scan already in progress", "info", "Settings");
      return;
    }
    setServerScanning(true);
    try {
      const res = await fetch(`${API_BASE}/api/selftify/scan`, { method: "POST" });
      if (res.status === 409) {
        useStatusStore.getState().addMessage("Scan already in progress", "info", "Settings");
        setServerScanning(false);
        return;
      }
      if (!res.ok) {
        const err = await res.json();
        useStatusStore.getState().addMessage(err.error || "Scan failed to start", "warn", "Settings");
        setServerScanning(false);
      }
    } catch {
      useStatusStore.getState().addMessage("Failed to start scan", "danger", "Settings");
      setServerScanning(false);
    }
  }

  const [form, setForm] = useState({
    folderPath: "",
    downloadFolder: "",
  });
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  function handleAddLocal() {
    setLoading(true);
    setAuthError(null);
    try {
      if (!form.folderPath) {
        setAuthError("Please select a music folder");
        return;
      }
      const origin = buildLocalOrigin(form);
      addOrigin(origin);
      setCurrentOrigin(origin);

      if (form.folderPath) {
        import("../../api/indexer/indexer").then(({ getIndexer }) =>
          getIndexer(origin).then((idx) => idx.start(origin))
        );
      }
      setForm({ folderPath: "", downloadFolder: "" });
    } finally {
      setLoading(false);
    }
  }

  async function handleBrowseFolder() {
    const { getPlatformService } = await import("../../services/platform/factory");
    const platform = await getPlatformService();
    const selected = await platform.openFolderPicker();
    if (selected) {
      setForm({ ...form, folderPath: selected, downloadFolder: selected });
    }
  }

  async function handleBrowseDownload() {
    const { getPlatformService } = await import("../../services/platform/factory");
    const platform = await getPlatformService();
    const selected = await platform.openFolderPicker();
    if (selected) {
      setForm({ ...form, downloadFolder: selected });
    }
  }

  async function handleClearImageCache() {
    setClearingImageCache(true);
    console.debug("[settings] clearing image cache");
    useStatusStore.getState().addMessage("Clearing image cache...", "info", "Settings");
    try {
      const { clearImageCaches } = await import("../../services/image-fetch");
      await clearImageCaches();
      console.debug("[settings] image cache cleared");
      useStatusStore.getState().addMessage("Image cache cleared", "success", "Settings");
    } catch (err) {
      console.error("[settings] image cache clear failed:", err);
      useStatusStore.getState().addMessage("Image cache clear failed", "danger", "Settings");
    } finally {
      setClearingImageCache(false);
    }
  }

  async function handleCheckYtDlp() {
    if (!(window as any).electronApi) return;
    setCheckingYtDlp(true);
    setYtDlpUpdateMsg(null);
    try {
      const result = await (window as any).electronApi.yt.checkVersion();
      setYtDlpFound(result.found);
      setYtDlpVersion(result.version);
      useStatusStore.getState().addMessage(
        result.found ? `yt-dlp v${result.version}` : "yt-dlp not found",
        result.found ? "info" : "warn",
        "Settings"
      );
    } catch (err) {
      setYtDlpFound(false);
      setYtDlpVersion(null);
      useStatusStore.getState().addMessage("Failed to check yt-dlp", "danger", "Settings");
    } finally {
      setCheckingYtDlp(false);
    }
  }

  async function handleUpdateYtDlp() {
    if (!(window as any).electronApi) return;
    setUpdatingYtDlp(true);
    setYtDlpUpdateMsg(null);
    useStatusStore.getState().addMessage("Updating yt-dlp...", "info", "Settings");
    try {
      const result = await (window as any).electronApi.yt.update();
      setYtDlpUpdateMsg(result.message);
      useStatusStore.getState().addMessage(
        result.success ? "yt-dlp updated" : "yt-dlp update failed",
        result.success ? "success" : "danger",
        "Settings"
      );
      if (result.success) {
        const version = await (window as any).electronApi.yt.checkVersion();
        setYtDlpFound(version.found);
        setYtDlpVersion(version.version);
      }
    } catch (err) {
      setYtDlpUpdateMsg("Update failed");
      useStatusStore.getState().addMessage("yt-dlp update failed", "danger", "Settings");
    } finally {
      setUpdatingYtDlp(false);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="shrink-0 px-6 pt-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Configure your music sources and preferences</p>
        </div>
      </div>

      <Tabs defaultValue={initialTab || "servers"}>
            <div className="shrink-0 px-6">
              <div className="mx-auto max-w-3xl">
                <TabsList>
                  <TabsTrigger value="servers">Servers</TabsTrigger>
                  <TabsTrigger value="library">Library</TabsTrigger>
                  <TabsTrigger value="playback">Playback</TabsTrigger>
                  <TabsTrigger value="audio">Audio</TabsTrigger>
                  <TabsTrigger value="visualizer">Visualizer</TabsTrigger>
                  <TabsTrigger value="network">Network</TabsTrigger>
                  <TabsTrigger value="ranking">Ranking</TabsTrigger>
                  <TabsTrigger value="search">Search</TabsTrigger>
                  <TabsTrigger value="artwork">Artwork</TabsTrigger>
                  <TabsTrigger value="appearance">Appearance</TabsTrigger>
                </TabsList>
              </div>
            </div>

            <div className="px-6">
              <div className="mx-auto max-w-3xl space-y-8 py-6">
                <TabsContent value="servers" className="space-y-4">
              {/* ── Backend Connection ── */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Selftify Server</CardTitle>
                  <CardDescription>Configure the server's music library folder and trigger scans</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">Library Root</label>
                    <div className="mt-1 flex gap-2">
                      <Input
                        className="flex-1 font-mono text-sm"
                        placeholder="/path/to/music"
                        value={serverLibraryRoot}
                        onChange={(e) => setServerLibraryRoot(e.target.value)}
                      />
                      <Button variant="outline" size="icon" onClick={() => setBrowserOpen(true)} title="Browse server folders">
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {serverDbReady ? "Database ready" : "Database not initialized — save a valid path first"}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={handleSaveServerConfig} disabled={serverConfigSaving || !serverLibraryRoot}>
                      {serverConfigSaving ? "Saving..." : "Save"}
                    </Button>
                    <Button variant="secondary" onClick={handleStartScan} disabled={serverScanning || !serverDbReady}>
                      {serverScanning ? "Scanning..." : "Scan"}
                    </Button>
                  </div>

                  {serverScanStatus && serverScanning && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Scanning... {serverScanStatus.progress.done}/{serverScanStatus.progress.total || "?"}
                      </p>
                      {serverScanStatus.progress.currentItem && (
                        <p className="truncate text-xs text-muted-foreground">
                          {serverScanStatus.progress.currentItem}
                        </p>
                      )}
                      {serverScanStatus.progress.total > 0 && (
                        <div className="h-1.5 w-full rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{
                              width: `${Math.min(100, Math.round((serverScanStatus.progress.done / serverScanStatus.progress.total) * 100))}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {serverScanStatus?.status === "done" && (
                    <p className="text-xs text-green-500">Scan complete</p>
                  )}
                  {serverScanStatus?.status === "error" && (
                    <p className="text-xs text-destructive">Scan failed</p>
                  )}
                </CardContent>
              </Card>

              <LibraryBrowserDialog
                open={browserOpen}
                onOpenChange={setBrowserOpen}
                currentPath={serverLibraryRoot || "/"}
                onSelect={(path) => {
                  setServerLibraryRoot(path);
                  setBrowserOpen(false);
                }}
              />

              {/* ── Online Search (global, always available) ── */}
              <OnlineSearchCard />

              {/* ── Local Library (standalone mode) ── */}
              {!useBackendStore.getState().config && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Local Library</CardTitle>
                    <CardDescription>Manage your local music sources (standalone mode)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {origins.length === 0 && (
                      <p className="text-sm text-muted-foreground">No sources configured yet. Add one below.</p>
                    )}
                    {origins.map((o) => (
                      <div key={o.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <p className="font-medium">{o.name}</p>
                          <p className="text-xs text-muted-foreground">
                            LOCAL {o.folderPath ? `\u2022 ${o.folderPath}` : ""}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setCurrentOrigin(o)}>
                            Select
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setEditingOrigin(o)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => useAuthStore.getState().removeOrigin(o.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {editingOrigin && (
                      <OriginEditDialog
                        origin={editingOrigin}
                        open={!!editingOrigin}
                        onOpenChange={(open) => { if (!open) setEditingOrigin(null); }}
                      />
                    )}

                    <Separator />

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

                    {authError && (
                      <p className="text-sm text-destructive">{authError}</p>
                    )}

                    <Button className="w-full" onClick={handleAddLocal} disabled={loading}>
                      {loading ? "Scanning..." : "Add Local Source"}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="library" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Local Library</CardTitle>
                  <CardDescription>Manage your local music collection</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="font-medium mb-1">Organize Files</p>
                    <p className="text-sm text-muted-foreground mb-3">
                      Rename and move files to follow the <code>Artist/Album (Year)/NN - Title.ext</code> convention.
                      Generates <code>cover.jpg</code>, <code>album.nfo</code>, and <code>artist.nfo</code> sidecar files.
                    </p>
                    <Button
                      variant="default"
                      onClick={async () => {
                        const { organizeAllFiles } = await import("../../services/organizer/manual-organizer");
                        setOrganizing(true);
                        try {
                          await organizeAllFiles();
                        } finally {
                          setOrganizing(false);
                        }
                      }}
                      disabled={organizing}
                    >
                      {organizing ? "Organizing..." : "Organize Files"}
                    </Button>
                    <div className="mt-4">
                      <p className="font-medium mb-1">Sync Metadata</p>
                      <p className="text-sm text-muted-foreground mb-3">
                        Update audio file metadata tags, embed cover art from .img/ folders, and regenerate album/artist .nfo files.
                      </p>
                      <Button
                        variant="default"
                        onClick={async () => {
                          const { syncAlbumMetadata } = await import("../../services/organizer/sync-metadata");
                          setSyncingMetadata(true);
                          try {
                            await syncAlbumMetadata();
                          } finally {
                            setSyncingMetadata(false);
                          }
                        }}
                        disabled={syncingMetadata}
                      >
                        {syncingMetadata ? "Syncing..." : "Sync Metadata"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="playback" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Playback Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Crossfade (Fade In / Fade Out)</p>
                      <p className="text-sm text-muted-foreground">Smooth volume fade at start and end of each track</p>
                    </div>
                    <Switch checked={crossfadeEnabled} onCheckedChange={setCrossfadeEnabled} />
                  </div>
                  {crossfadeEnabled && (
                    <div className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Fade in (track start)</span>
                          <span>{fadeInDuration}s</span>
                        </div>
                        <Slider
                          value={[fadeInDuration]}
                          onValueChange={([v]) => setFadeInDuration(v)}
                          min={0}
                          max={12}
                          step={0.5}
                        />
                        <p className="text-xs text-muted-foreground">0s = instant start</p>
                      </div>
                      <Separator />
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Fade out (track end)</span>
                          <span>{fadeOutDuration}s</span>
                        </div>
                        <Slider
                          value={[fadeOutDuration]}
                          onValueChange={([v]) => setFadeOutDuration(v)}
                          min={0}
                          max={12}
                          step={0.5}
                        />
                        <p className="text-xs text-muted-foreground">0s = instant stop</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="audio" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Audio Output</CardTitle>
                  <CardDescription>Select audio output devices</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Auto-switch output</p>
                      <p className="text-sm text-muted-foreground">
                        Automatically switch to new default device when system output changes
                      </p>
                    </div>
                    <Switch checked={autoSwitchOutput} onCheckedChange={setAutoSwitchOutput} />
                  </div>

                  <Separator />

                  <div>
                    <p className="mb-2 text-sm font-medium">Available devices</p>
                    {audioDevices.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No audio output devices detected. Make sure the app has microphone permissions.
                      </p>
                    )}
                    <div className="space-y-2">
                      {audioDevices.map((device) => {
                        const isActive = activeAudioOutputs.length === 0
                          ? device.isDefault
                          : activeAudioOutputs.includes(device.deviceId);
                        const isSelected = activeAudioOutputs.includes(device.deviceId);

                        function toggleDevice() {
                          if (isSelected) {
                            setActiveAudioOutputs(activeAudioOutputs.filter((id) => id !== device.deviceId));
                          } else {
                            setActiveAudioOutputs([...activeAudioOutputs, device.deviceId]);
                          }
                        }

                        return (
                          <div
                            key={device.deviceId}
                            className="flex items-center justify-between rounded-lg border p-3"
                          >
                            <div className="flex items-center gap-3">
                              <Volume2 className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="text-sm font-medium">
                                  {device.label}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {device.deviceId === "default" ? "System default" : device.deviceId}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isActive && (
                                <span className="flex items-center gap-1 text-xs text-green-500">
                                  <Check className="h-3 w-3" /> Active
                                </span>
                              )}
                              <Button
                                variant={isSelected ? "default" : "outline"}
                                size="sm"
                                onClick={toggleDevice}
                              >
                                {isSelected ? "Selected" : "Select"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="visualizer" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Visualizer Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Enable Visualizer</p>
                      <p className="text-sm text-muted-foreground">Show audio visualizations</p>
                    </div>
                    <Switch checked={visualizerEnabled} onCheckedChange={setVisualizerEnabled} />
                  </div>
                  {visualizerEnabled && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Visualizer Engine</p>
                      <div className="flex gap-2">
                        {(["butterchurn", "audiomotion", "none"] as VisualizerType[]).map((type) => (
                          <Button
                            key={type}
                            variant={visualizerType === type ? "default" : "outline"}
                            size="sm"
                            onClick={() => setVisualizerType(type)}
                          >
                            {type}
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Butterchurn: MilkDrop-style visualizer (GPU heavy). AudioMotion: spectrum analyzer.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="network" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Network Settings</CardTitle>
                  <CardDescription>Control timeout and caching behavior for YouTube / MusicBrainz operations</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Fetch Timeout (ms)</span>
                      <span>{imageFetchTimeoutMs}ms</span>
                    </div>
                    <Slider value={[imageFetchTimeoutMs]} onValueChange={([v]) => setImageFetchTimeoutMs(v)} min={1000} max={60000} step={1000} />
                    <p className="text-xs text-muted-foreground">Time before an image request is aborted</p>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Search Timeout (ms)</span>
                      <span>{searchTimeoutMs}ms</span>
                    </div>
                    <Slider value={[searchTimeoutMs]} onValueChange={([v]) => setSearchTimeoutMs(v)} min={5000} max={120000} step={1000} />
                    <p className="text-xs text-muted-foreground">Max time for a YouTube search operation</p>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Stream Timeout (ms)</span>
                      <span>{streamTimeoutMs}ms</span>
                    </div>
                    <Slider value={[streamTimeoutMs]} onValueChange={([v]) => setStreamTimeoutMs(v)} min={5000} max={120000} step={1000} />
                    <p className="text-xs text-muted-foreground">Max time for extracting a YouTube stream URL</p>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Cache TTL (minutes)</span>
                      <span>{cacheTtlMinutes}min</span>
                    </div>
                    <Slider value={[cacheTtlMinutes]} onValueChange={([v]) => setCacheTtlMinutes(v)} min={1} max={1440} step={5} />
                    <p className="text-xs text-muted-foreground">How long search results stay cached before re-fetching</p>
                  </div>
                  <Separator />
                  <div>
                    <Button variant="outline" size="sm" className="gap-2" onClick={() => setCacheModalOpen(true)}>
                      <Database className="h-4 w-4" /> Manage Cache
                    </Button>
                    <p className="mt-1 text-xs text-muted-foreground">View and clear cached search results and MB→YT mappings</p>
                  </div>
                  <Separator />
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={handleClearImageCache}
                      disabled={clearingImageCache}
                    >
                      <Trash2 className="h-4 w-4" /> {clearingImageCache ? "Clearing images..." : "Clear Image Cache"}
                    </Button>
                    <p className="mt-1 text-xs text-muted-foreground">Remove cached album, artist, and search thumbnails so they are fetched again</p>
                  </div>
                  <Separator />
                  <div className="space-y-3">
                    <div>
                      <p className="font-medium">yt-dlp</p>
                      <p className="text-sm text-muted-foreground">
                        {ytDlpFound
                          ? `Version ${ytDlpVersion}`
                          : ytDlpVersion === null && !checkingYtDlp
                            ? "Click check to detect"
                            : "Not found"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="gap-2" onClick={handleCheckYtDlp} disabled={checkingYtDlp || updatingYtDlp}>
                        <RefreshCw className={`h-4 w-4 ${checkingYtDlp ? "animate-spin" : ""}`} />
                        {checkingYtDlp ? "Checking..." : "Check Version"}
                      </Button>
                      {ytDlpFound && (
                        <Button variant="outline" size="sm" className="gap-2" onClick={handleUpdateYtDlp} disabled={updatingYtDlp}>
                          <Download className={`h-4 w-4 ${updatingYtDlp ? "animate-spin" : ""}`} />
                          {updatingYtDlp ? "Updating..." : "Update"}
                        </Button>
                      )}
                    </div>
                    {ytDlpUpdateMsg && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{ytDlpUpdateMsg}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ranking" className="space-y-4">
              <RankingView />
            </TabsContent>

            <TabsContent value="search" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">YouTube Search Fields</CardTitle>
                  <CardDescription>
                    Control which MusicBrainz fields are included when searching YouTube via yt-dlp.
                    Fields marked OFF are omitted from the search query but still used internally for ranking.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {YT_SEARCH_FIELD_META.map(({ key, label, description }) => (
                    <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex-1">
                        <p className="font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                      <Switch
                        id={`yt-field-${key}`}
                        checked={ytSearchFields[key]}
                        onCheckedChange={(v) => setYtSearchFields({ [key]: v })}
                      />
                    </div>
                  ))}

                  <Separator />

                  <div>
                    <p className="mb-1 text-sm font-medium">Query Preview</p>
                    <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs">
                      {buildSearchPreview(ytSearchFields) || <span className="italic text-muted-foreground">No fields selected — search will fail</span>}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Example using <em>Metallica — Enter Sandman — Metallica (1991)</em>
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Cover Image Priority</CardTitle>
                  <CardDescription>
                    Choose which cover image source takes precedence during playback.
                    "File system" checks the <code>.img/</code> folder first; "Embedded" uses the cover art extracted from audio file tags.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    {COVER_PRIORITY_OPTIONS.map(({ value, label, description }) => (
                      <div
                        key={value}
                        className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                          coverPriority === value ? "border-primary" : ""
                        }`}
                        onClick={() => setCoverPriority(value)}
                      >
                        <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                          coverPriority === value
                            ? "border-primary bg-primary"
                            : "border-muted-foreground"
                        }`}>
                          {coverPriority === value && (
                            <div className="h-full w-full rounded-full bg-primary" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">{description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="artwork" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Artwork Providers</CardTitle>
                  <CardDescription>
                    Control which artwork providers are active and their request rate
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(artworkProviders).length === 0 && (
                    <p className="text-sm text-muted-foreground">No artwork providers configured.</p>
                  )}
                  {Object.entries(artworkProviders).map(([name, setting]) => {
                    const providerMeta = PROVIDER_META[name] || {
                      label: name,
                      description: "",
                      domain: "",
                    };
                    return (
                      <div
                        key={name}
                        className={`rounded-lg border p-4 transition-opacity ${
                          setting.enabled ? "" : "opacity-50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Switch
                              id={`provider-${name}`}
                              checked={setting.enabled}
                              onCheckedChange={(v) =>
                                setArtworkProvider(name, { enabled: v })
                              }
                            />
                            <div>
                              <label
                                htmlFor={`provider-${name}`}
                                className="cursor-pointer font-medium"
                              >
                                {providerMeta.label}
                              </label>
                              <p className="text-xs text-muted-foreground">
                                {providerMeta.description}
                              </p>
                              <code className="text-[10px] text-muted-foreground">
                                {providerMeta.domain}
                              </code>
                            </div>
                          </div>
                          <span className="whitespace-nowrap text-xs font-mono tabular-nums">
                            {setting.paceMs >= 1000
                              ? `${(setting.paceMs / 1000).toFixed(0)}s`
                              : `${setting.paceMs}ms`}
                          </span>
                        </div>
                        {setting.enabled && (
                          <div className="mt-3 space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Fast (100ms)</span>
                              <span>Slow (10s)</span>
                            </div>
                            <Slider
                              value={[setting.paceMs]}
                              onValueChange={([v]) =>
                                setArtworkProvider(name, { paceMs: v })
                              }
                              min={100}
                              max={10000}
                              step={50}
                            />
                            <p className="text-xs text-muted-foreground">
                              Delay between requests — lower is faster but uses more API quota
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="appearance" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Appearance</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Theme</p>
                      <p className="text-sm text-muted-foreground">Dark, Light, or System theme</p>
                    </div>
                    <div className="flex gap-1">
                      {(["dark", "light", "system"] as const).map((t) => (
                        <Button
                          key={t}
                          variant={theme === t ? "default" : "outline"}
                          size="sm"
                          onClick={() => setTheme(t)}
                        >
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Sidebar</p>
                      <p className="text-sm text-muted-foreground">Currently {sidebarCollapsed ? "collapsed" : "expanded"}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Animations</p>
                      <p className="text-sm text-muted-foreground">Rotating artist backgrounds and effects</p>
                    </div>
                    <Switch checked={animationsEnabled} onCheckedChange={setAnimationsEnabled} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </div>
      </Tabs>
      <CacheManagerModal open={cacheModalOpen} onOpenChange={setCacheModalOpen} />
    </div>
  );
}
