import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore, VisualizerType } from "../../stores/settings.store";
import { buildLocalOrigin } from "../../lib/build-navigation";
import { Origin } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
import { Slider } from "../../components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { Separator } from "../../components/ui/separator";
import { useState, useEffect } from "react";
import { Trash2, Volume2, Check, FolderOpen, Pencil, Globe, Database } from "lucide-react";
import { AudioOutputManager } from "../../services/audio-output/audio-output-manager";
import type { AudioDevice } from "../../services/audio-output/audio-output-strategy";
import { OriginEditDialog } from "./origin-edit-dialog";
import { CacheManagerModal } from "./cache-manager-modal";
import { RankingView } from "./ranking-view";
import { useStatusStore } from "../../stores/status.store";

const PROVIDER_META: Record<string, { label: string; description: string; domain: string }> = {
  embedded: { label: "Embedded Tags", description: "Cover art extracted from file tags", domain: "local" },
  cover_art_archive: { label: "Cover Art Archive", description: "Official covers indexed by MusicBrainz", domain: "coverartarchive.org" },
  musicbrainz_release_group: { label: "MusicBrainz RG", description: "Release group → releases → CAA", domain: "musicbrainz.org" },
  itunes: { label: "iTunes Search", description: "Apple Music / iTunes Store album art", domain: "itunes.apple.com" },
  deezer: { label: "Deezer", description: "Deezer album covers", domain: "api.deezer.com" },
};

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

  const [form, setForm] = useState({
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
      setForm({ folderPath: "", downloadFolder: "", enableOnlineSearch: false, musicBrainzToken: "", musicBrainzClientId: "", musicBrainzClientSecret: "", musicBrainzRefreshToken: "", musicBrainzTokenExpiresAt: 0, youtubeMusicHeaders: "" });
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

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Configure your music sources and preferences</p>
        </div>
      </div>

      <Tabs defaultValue={initialTab || "servers"} className="flex min-h-0 flex-1 flex-col">
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
                  <TabsTrigger value="artwork">Artwork</TabsTrigger>
                  <TabsTrigger value="appearance">Appearance</TabsTrigger>
                </TabsList>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6">
              <div className="mx-auto max-w-3xl space-y-8 py-6">
                <TabsContent value="servers" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Connected Sources</CardTitle>
                  <CardDescription>Manage your local music sources</CardDescription>
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
                          {o.enableOnlineSearch ? " \u2022 Online Search" : ""}
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Add Source</CardTitle>
                  <CardDescription>Add a local music folder</CardDescription>
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
                      <Globe className="mr-1 inline h-3 w-3" /> Enable Online Search
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
                          Paste HTTP headers from a browser session on music.youtube.com. One per line (key: value).
                        </p>
                      </div>
                    </div>
                  )}

                  {authError && (
                    <p className="text-sm text-destructive">{authError}</p>
                  )}

                  <Button className="w-full" onClick={handleAddLocal} disabled={loading}>
                    {loading ? "Scanning..." : form.enableOnlineSearch ? "Add Local Source + Online Search" : "Add Local Source"}
                  </Button>
                </CardContent>
              </Card>
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
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ranking" className="space-y-4">
              <RankingView />
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
