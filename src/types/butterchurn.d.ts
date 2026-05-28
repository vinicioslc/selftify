declare module "butterchurn" {
  interface VisualizerOptions {
    width: number;
    height: number;
    pixelRatio: number;
    textureRatio: number;
  }

  interface Visualizer {
    loadPreset(preset: any, blendTime: number): void;
    render(): void;
    setAudioData(data: { waveform: Float32Array; frequency: Uint8Array }): void;
    launchPreset(preset: any, blendTime: number): void;
    connectAudio(input: any): void;
  }

  function createVisualizer(
    audioContext: AudioContext | null,
    canvas: HTMLCanvasElement,
    options: VisualizerOptions
  ): Visualizer;

  export default { createVisualizer };
}

declare module "butterchurn-presets" {
  function getPresets(): Record<string, any>;
  export default { getPresets };
}

declare module "@tauri-apps/plugin-fs" {
  export interface ReadDirOptions {
    recursive?: boolean;
  }

  export function readDir(
    path: string,
    options?: ReadDirOptions
  ): Promise<any[]>;

  export function readFile(path: string): Promise<Uint8Array>;
}

declare module "@tauri-apps/plugin-dialog" {
  export interface OpenDialogOptions {
    directory?: boolean;
    multiple?: boolean;
    title?: string;
    defaultPath?: string;
  }

  export function open(options?: OpenDialogOptions): Promise<string | string[] | null>;
}
