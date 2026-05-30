import { app } from 'electron';
import { execSync } from 'node:child_process';
import MpvAPI from 'node-mpv';
import { pid } from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import { isWindows, isMacOS } from './../utils';

let mpvInstance: MpvAPI | null = null;

let _mpvAvailable = false;
export function isMpvAvailable(): boolean {
  return _mpvAvailable;
}

const socketPath = isWindows()
  ? `\\\\.\\pipe\\mpvserver-${pid}`
  : `/tmp/ytmusic-mpv-${pid}.sock`;

function findBundledBinary(): string | null {
  const platform = isWindows() ? 'win32' : isMacOS() ? 'darwin' : 'linux';
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'mpv')
    : path.join(app.getAppPath(), 'resources', 'mpv', platform);

  const binaryName = isWindows() ? 'mpv.exe' : 'mpv';
  const candidate = path.join(resourcesPath, binaryName);

  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function findSystemMpv(): string | null {
  try {
    const result = execSync(
      isWindows() ? 'where mpv' : 'which mpv',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    return result || null;
  } catch {
    return null;
  }
}

function resolveMpvBinary(): string | null {
  const bundled = findBundledBinary();
  if (bundled) {
    console.log('[mpv] Using bundled binary:', bundled);
    return bundled;
  }

  const system = findSystemMpv();
  if (system) {
    console.log('[mpv] Using system mpv:', system);
    return system;
  }

  console.log('[mpv] No mpv binary found — will fall back to Web Audio API');
  return null;
}

function getMpv(): MpvAPI {
  if (!mpvInstance) {
    const binary = resolveMpvBinary();
    if (!binary) {
      _mpvAvailable = false;
      throw new Error('No mpv binary available');
    }

    mpvInstance = new MpvAPI(
      {
        audio_only: true,
        socket: socketPath,
        time_update: 1,
        binary,
      },
      ['--no-video', '--no-audio-display', '--vo=null'],
    );
  }
  return mpvInstance;
}

export function getSocketPath(): string {
  return socketPath;
}

export async function startMpv(): Promise<void> {
  try {
    const mpv = getMpv();
    await mpv.start();
    _mpvAvailable = true;
    console.log('[mpv] Started successfully');
  } catch (err) {
    _mpvAvailable = false;
    console.error('[mpv] Failed to start:', err);
    throw err;
  }
}

export async function loadTrack(url: string): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.load(url, 'replace');
}

export async function play(): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.play();
}

export async function pause(): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.pause();
}

export async function stop(): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.stop();
}

export async function seek(seconds: number): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.goToPosition(seconds);
}

export async function setVolume(volume: number): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.volume(volume);
}

export async function getVolume(): Promise<number> {
  if (!_mpvAvailable) return 0;
  const mpv = getMpv();
  return mpv.getProperty('volume');
}

export async function getProperty(prop: string): Promise<any> {
  if (!_mpvAvailable) return null;
  const mpv = getMpv();
  return mpv.getProperty(prop);
}

export async function setProperty(prop: string, value: any): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.setProperty(prop, value);
}

export async function appendTrack(url: string, play = false): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.append(url, play ? 'append-play' : 'append');
}

export async function nextTrack(): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.next('force');
}

export async function previousTrack(): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.prev('force');
}

export async function clearPlaylist(): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.clearPlaylist();
}

export async function listAudioDevices(): Promise<{ name: string; description: string }[]> {
  if (!_mpvAvailable) return [];
  const mpv = getMpv();
  return mpv.getProperty('audio-device-list');
}

export async function setAudioDevice(name: string): Promise<void> {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  await mpv.setProperty('audio-device', name);
}

export function onEvent(event: string, callback: (...args: any[]) => void): void {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  mpv.on(event, callback);
}

export function removeAllListeners(event?: string): void {
  if (!_mpvAvailable) return;
  const mpv = getMpv();
  mpv.removeAllListeners(event);
}

export async function quitMpv(): Promise<void> {
  if (mpvInstance) {
    try {
      await mpvInstance.quit();
    } catch { }
    mpvInstance = null;
  }
  _mpvAvailable = false;
}
