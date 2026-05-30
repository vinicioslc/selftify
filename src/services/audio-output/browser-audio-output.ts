import { AudioDevice, AudioOutputStrategy } from "./audio-output-strategy";

function getMediaDevices(): MediaDevices | null {
  return navigator?.mediaDevices ?? null;
}

function deviceToAudioDevice(device: MediaDeviceInfo, isDefault: boolean): AudioDevice {
  return {
    deviceId: device.deviceId,
    groupId: device.groupId,
    label: device.label || `Audio Output ${device.deviceId.slice(0, 8)}`,
    isDefault,
  };
}

export class BrowserAudioOutputStrategy implements AudioOutputStrategy {
  private listeners = new Set<() => void>();
  private boundHandler: ((this: MediaDevices, ev: Event) => void) | null = null;

  async getDevices(): Promise<AudioDevice[]> {
    try {
      const md = getMediaDevices();
      if (!md) return [];
      const all = await md.enumerateDevices();
      const outputs = all.filter((d) => d.kind === "audiooutput");
      const defaultId = await this.getDefaultDeviceId();
      return outputs.map((d) => deviceToAudioDevice(d, d.deviceId === defaultId));
    } catch {
      return [];
    }
  }

  async getDefaultDeviceId(): Promise<string | null> {
    try {
      const md = getMediaDevices();
      if (!md) return null;
      const all = await md.enumerateDevices();
      const defaultOutput = all.find(
        (d) => d.kind === "audiooutput" && d.deviceId === "default"
      );
      return defaultOutput?.deviceId ?? null;
    } catch {
      return null;
    }
  }

  async setSinkId(audio: HTMLAudioElement, deviceId: string): Promise<void> {
    if (!("setSinkId" in audio)) {
      throw new Error("setSinkId not supported");
    }
    await (audio as any).setSinkId(deviceId);
  }

  onDeviceChange(callback: () => void): () => void {
    this.listeners.add(callback);

    const md = getMediaDevices();
    if (!this.boundHandler && md) {
      this.boundHandler = () => {
        for (const fn of this.listeners) fn();
      };
      md.addEventListener("devicechange", this.boundHandler);
    }

    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0 && this.boundHandler && md) {
        md.removeEventListener("devicechange", this.boundHandler);
        this.boundHandler = null;
      }
    };
  }

  supportsMultipleOutputs(): boolean {
    return false;
  }
}
