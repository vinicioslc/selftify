import { AudioDevice, AudioOutputStrategy } from "./audio-output-strategy";
import { BrowserAudioOutputStrategy } from "./browser-audio-output";

function getMpvApi() {
  return (window as any).electronApi?.mpv;
}

export class DesktopAudioOutputStrategy implements AudioOutputStrategy {
  private browserFallback = new BrowserAudioOutputStrategy();

  async getDevices(): Promise<AudioDevice[]> {
    try {
      const mpv = getMpvApi();
      if (!mpv) throw new Error('No mpv API');
      const devices = await mpv.listDevices();
      return (devices || []).map((d: any) => ({
        deviceId: d.name,
        label: d.description || d.name,
        groupId: '',
        kind: 'audiooutput' as const,
      }));
    } catch {
      return this.browserFallback.getDevices();
    }
  }

  async getDefaultDeviceId(): Promise<string | null> {
    return this.browserFallback.getDefaultDeviceId();
  }

  async setSinkId(audio: HTMLAudioElement, deviceId: string): Promise<void> {
    try {
      const mpv = getMpvApi();
      if (mpv) {
        await mpv.setDevice(deviceId);
        return;
      }
    } catch {}
    await this.browserFallback.setSinkId(audio, deviceId);
  }

  onDeviceChange(callback: () => void): () => void {
    return this.browserFallback.onDeviceChange(callback);
  }

  supportsMultipleOutputs(): boolean {
    return false;
  }
}
