import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore, VisualizerType } from "../../stores/settings.store";
import { OriginType } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Slider } from "../../components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { Separator } from "../../components/ui/separator";
import { useState, useEffect } from "react";
import { Plus, Trash2, Volume2, Check } from "lucide-react";
import { AudioOutputManager } from "../../services/audio-output/audio-output-manager";
import type { AudioDevice } from "../../services/audio-output/audio-output-strategy";

export function SettingsPage() {
  const { origins, addOrigin, removeOrigin, setCurrentOrigin } = useAuthStore();
  const {
    theme, setTheme,
    visualizerType, setVisualizerType,
    visualizerEnabled, setVisualizerEnabled,
    crossfadeEnabled, setCrossfadeEnabled,
    crossfadeDuration, setCrossfadeDuration,
    sidebarCollapsed,
    activeAudioOutputs, setActiveAudioOutputs,
    autoSwitchOutput, setAutoSwitchOutput,
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

  const [newServer, setNewServer] = useState({
    name: "",
    type: OriginType.NAVIDROME,
    url: "",
  });

  function handleAddServer() {
    if (!newServer.name) return;
    addOrigin({
      id: crypto.randomUUID(),
      name: newServer.name,
      type: newServer.type,
      url: newServer.url || undefined,
    });
    setNewServer({ name: "", type: OriginType.NAVIDROME, url: "" });
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-8 p-6">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Configure your music sources and preferences</p>
          </div>

          <Tabs defaultValue="servers">
            <TabsList>
              <TabsTrigger value="servers">Servers</TabsTrigger>
              <TabsTrigger value="playback">Playback</TabsTrigger>
              <TabsTrigger value="audio">Audio</TabsTrigger>
              <TabsTrigger value="visualizer">Visualizer</TabsTrigger>
              <TabsTrigger value="appearance">Appearance</TabsTrigger>
            </TabsList>

            <TabsContent value="servers" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Connected Servers</CardTitle>
                  <CardDescription>Add and manage your music origins</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {origins.map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="font-medium">{o.name}</p>
                        <p className="text-xs text-muted-foreground">{o.type} {o.url ? `• ${o.url}` : ""}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setCurrentOrigin(o)}>
                          Select
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => removeOrigin(o.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Add Server</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    placeholder="Server name"
                    value={newServer.name}
                    onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  />
                  <div className="flex gap-2">
                    {[OriginType.NAVIDROME, OriginType.JELLYFIN, OriginType.YOUTUBE_MUSIC].map((type) => (
                      <Button
                        key={type}
                        variant={newServer.type === type ? "default" : "outline"}
                        size="sm"
                        onClick={() => setNewServer({ ...newServer, type })}
                      >
                        {type}
                      </Button>
                    ))}
                  </div>
                  <Input
                    placeholder="Server URL (for Navidrome/Jellyfin)"
                    value={newServer.url}
                    onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button onClick={handleAddServer}>
                      <Plus className="mr-2 h-4 w-4" /> Add
                    </Button>
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
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
