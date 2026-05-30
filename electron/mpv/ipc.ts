import { ipcMain } from 'electron';
import {
  loadTrack, play, pause, stop, seek, setVolume, getVolume,
  nextTrack, previousTrack, clearPlaylist, listAudioDevices, setAudioDevice,
  getProperty, setProperty, appendTrack, isMpvAvailable,
} from './manager';

export function registerMpvIpc(): void {
  ipcMain.handle('mpv:is-available', () => isMpvAvailable());

  ipcMain.handle('mpv:load', (_e, url: string) => loadTrack(url));
  ipcMain.handle('mpv:play', () => play());
  ipcMain.handle('mpv:pause', () => pause());
  ipcMain.handle('mpv:stop', () => stop());
  ipcMain.handle('mpv:seek', (_e, secs: number) => seek(secs));
  ipcMain.handle('mpv:volume', (_e, vol?: number) => {
    if (vol !== undefined) return setVolume(vol);
    return getVolume();
  });
  ipcMain.handle('mpv:next', () => nextTrack());
  ipcMain.handle('mpv:prev', () => previousTrack());
  ipcMain.handle('mpv:clear-playlist', () => clearPlaylist());
  ipcMain.handle('mpv:append', (_e, url: string, play?: boolean) => appendTrack(url, play));
  ipcMain.handle('mpv:get-property', (_e, prop: string) => getProperty(prop));
  ipcMain.handle('mpv:set-property', (_e, prop: string, val: any) => setProperty(prop, val));
  ipcMain.handle('mpv:list-devices', () => listAudioDevices());
  ipcMain.handle('mpv:set-device', (_e, name: string) => setAudioDevice(name));
}
