export type AudioDevice = {
  deviceId: string;
  groupId: string;
  label: string;
  isDefault: boolean;
};

export interface AudioOutputStrategy {
  getDevices(): Promise<AudioDevice[]>;
  getDefaultDeviceId(): Promise<string | null>;
  setSinkId(audio: HTMLAudioElement, deviceId: string): Promise<void>;
  onDeviceChange(callback: () => void): () => void;
  supportsMultipleOutputs(): boolean;
}
