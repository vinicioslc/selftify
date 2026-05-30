function getApi() {
  return (window as any).electronApi?.mpv ?? null;
}

export async function loadTrack(url: string): Promise<void> {
  await getApi()?.load(url);
}

export async function pause(): Promise<void> {
  await getApi()?.pause();
}

export async function resume(): Promise<void> {
  await getApi()?.play();
}

export async function seek(positionSecs: number): Promise<void> {
  await getApi()?.seek(positionSecs);
}

export async function setVolume(volume: number): Promise<void> {
  await getApi()?.volume(volume);
}

export async function getPosition(): Promise<number> {
  return getApi()?.getProperty('time-pos') ?? 0;
}

export async function getDuration(): Promise<number> {
  return getApi()?.getProperty('duration') ?? 0;
}

export async function isPlaying(): Promise<boolean> {
  const paused = await getApi()?.getProperty('pause');
  return !paused;
}

export async function stopPlayback(): Promise<void> {
  await getApi()?.stop();
}
