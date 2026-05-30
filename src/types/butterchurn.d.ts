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
