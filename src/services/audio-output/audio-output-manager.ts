import { AudioDevice, AudioOutputStrategy } from "./audio-output-strategy";
import { BrowserAudioOutputStrategy } from "./browser-audio-output";
import { DesktopAudioOutputStrategy } from "./desktop-audio-output";

function hasElectronMpv(): boolean {
  return !!(window as any).electronApi?.mpv;
}

function createStrategy(): AudioOutputStrategy {
  if (hasElectronMpv()) {
    return new DesktopAudioOutputStrategy();
  }
  return new BrowserAudioOutputStrategy();
}

export class AudioOutputManager {
  private strategy: AudioOutputStrategy;
  private deviceChangeListeners = new Set<() => void>();
  private unsubscribeDeviceChange: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private _currentDeviceId: string | null = null;
  private _devices: AudioDevice[] = [];
  private _polling = false;

  constructor() {
    this.strategy = createStrategy();
  }

  get currentDeviceId(): string | null {
    return this._currentDeviceId;
  }

  get devices(): AudioDevice[] {
    return this._devices;
  }

  get strategyInstance(): AudioOutputStrategy {
    return this.strategy;
  }

  async init(): Promise<void> {
    await this.refreshDevices();
    this._currentDeviceId = await this.strategy.getDefaultDeviceId();
    this.startListening();
  }

  async refreshDevices(): Promise<AudioDevice[]> {
    this._devices = await this.strategy.getDevices();
    return this._devices;
  }

  async refreshDefaultDevice(): Promise<string | null> {
    const id = await this.strategy.getDefaultDeviceId();
    if (id && id !== this._currentDeviceId) {
      this._currentDeviceId = id;
      this.notifyDeviceChange();
    }
    return id;
  }

  async setSinkId(audio: HTMLAudioElement, deviceId: string): Promise<void> {
    await this.strategy.setSinkId(audio, deviceId);
    this._currentDeviceId = deviceId;
  }

  onDeviceChange(callback: () => void): () => void {
    this.deviceChangeListeners.add(callback);
    return () => {
      this.deviceChangeListeners.delete(callback);
    };
  }

  startPolling(intervalMs = 3000): void {
    if (this._polling) return;
    this._polling = true;
    this.pollTimer = setInterval(() => {
      this.refreshDefaultDevice();
    }, intervalMs);
  }

  stopPolling(): void {
    this._polling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  destroy(): void {
    this.stopListening();
    this.stopPolling();
    this.deviceChangeListeners.clear();
  }

  private startListening(): void {
    this.unsubscribeDeviceChange = this.strategy.onDeviceChange(() => {
      this.refreshDevices().then(() => this.refreshDefaultDevice());
    });
  }

  private stopListening(): void {
    if (this.unsubscribeDeviceChange) {
      this.unsubscribeDeviceChange();
      this.unsubscribeDeviceChange = null;
    }
  }

  private notifyDeviceChange(): void {
    for (const fn of this.deviceChangeListeners) {
      fn();
    }
  }
}
