import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore, VisualizerType } from "../../stores/settings.store";
import { Origin, OriginType } from "../../types/domain-types";
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
import { Trash2, Volume2, Check, FolderOpen, Pencil, Globe } from "lucide-react";
import { AudioOutputManager } from "../../services/audio-output/audio-output-manager";
import type { AudioDevice } from "../../services/audio-output/audio-output-strategy";
import { OriginEditDialog } from "./origin-edit-dialog";

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
    crossfadeDuration, setCrossfadeDuration,
    sidebarCollapsed,
    animationsEnabled, setAnimationsEnabled,
    activeAudioOutputs, setActiveAudioOutputs,
    autoSwitchOutput, setAutoSwitchOutput,
    imageFetchRateLimitMs, setImageFetchRateLimitMs,
    imageFetchMaxConcurrent, setImageFetchMaxConcurrent,
    imageFetchTimeoutMs, setImageFetchTimeoutMs,
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

  const [form, setForm] = useState({
    folderPath: "",
    downloadFolder: "",
    enableOnlineSearch: false,
    musicBrainzToken: "",
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
      const origin = {
        id: crypto.randomUUID(),
        name: form.folderPath.split("/").filter(Boolean).pop() || "Local Files",
        type: OriginType.LOCAL,
        folderPath: form.folderPath,
        downloadFolder: form.downloadFolder || form.folderPath,
        enableOnlineSearch: form.enableOnlineSearch,
        musicBrainzToken: form.musicBrainzToken || undefined,
        youtubeMusicHeaders: form.youtubeMusicHeaders || undefined,
      };
      addOrigin(origin);
      setCurrentOrigin(origin);

      if (form.folderPath) {
        import("../../api/indexer/indexer").then(({ getIndexer }) =>
          getIndexer(origin).then((idx) => idx.start(origin))
        );
      }
      setForm({ folderPath: "", downloadFolder: "", enableOnlineSearch: false, musicBrainzToken: "", youtubeMusicHeaders: "" });
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

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-8 p-6">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Configure your music sources and preferences</p>
          </div>

          <Tabs defaultValue={initialTab || "servers"}>
            <TabsList>
              <TabsTrigger value="servers">Servers</TabsTrigger>
              <TabsTrigger value="playback">Playback</TabsTrigger>
              <TabsTrigger value="audio">Audio</TabsTrigger>
              <TabsTrigger value="visualizer">Visualizer</TabsTrigger>
              <TabsTrigger value="network">Network</TabsTrigger>
              <TabsTrigger value="appearance">Appearance</TabsTrigger>
            </TabsList>

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

            <TabsContent value="playback" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Playback Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Crossfade</p>
                      <p className="text-sm text-muted-foreground">Smooth transition between tracks</p>
                    </div>
                    <Switch checked={crossfadeEnabled} onCheckedChange={setCrossfadeEnabled} />
                  </div>
                  {crossfadeEnabled && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Crossfade duration</span>
                        <span>{crossfadeDuration}s</span>
                      </div>
                      <Slider
                        value={[crossfadeDuration]}
                        onValueChange={([v]) => setCrossfadeDuration(v)}
                        min={1}
                        max={12}
                        step={1}
                      />
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
                  <CardDescription>Control how the app fetches cover art and other images</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Rate Limit (ms)</span>
                      <span>{imageFetchRateLimitMs}ms</span>
                    </div>
                    <Slider
                      value={[imageFetchRateLimitMs]}
                      onValueChange={([v]) => setImageFetchRateLimitMs(v)}
                      min={0}
                      max={5000}
                      step={100}
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimum interval between image requests (0 = no limit)
                    </p>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Max Concurrent Fetches</span>
                      <span>{imageFetchMaxConcurrent}</span>
                    </div>
                    <Slider
                      value={[imageFetchMaxConcurrent]}
                      onValueChange={([v]) => setImageFetchMaxConcurrent(v)}
                      min={1}
                      max={20}
                      step={1}
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum parallel image downloads
                    </p>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Fetch Timeout (ms)</span>
                      <span>{imageFetchTimeoutMs}ms</span>
                    </div>
                    <Slider
                      value={[imageFetchTimeoutMs]}
                      onValueChange={([v]) => setImageFetchTimeoutMs(v)}
                      min={1000}
                      max={60000}
                      step={1000}
                    />
                    <p className="text-xs text-muted-foreground">
                      Time before an image request is aborted
                    </p>
                  </div>
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
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
