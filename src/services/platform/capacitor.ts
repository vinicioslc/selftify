import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { PlatformService, DirEntry } from './types';

export function createCapacitorPlatformService(): PlatformService {
  return {
    isElectron: false,
    isAndroid: Capacitor.isNativePlatform(),
    isWeb: false,

    async openFolderPicker() {
      try {
        await Filesystem.requestPermissions();
        const result = await Filesystem.getUri({
          path: 'Music',
          directory: Directory.ExternalStorage,
        });
        return result.uri;
      } catch {
        return '/storage/emulated/0/Music';
      }
    },

    async openFilePicker(options) {
      try {
        await Filesystem.requestPermissions();
        const result = await Filesystem.getUri({
          path: '',
          directory: Directory.ExternalStorage,
        });
        return result.uri;
      } catch {
        return '/storage/emulated/0/Music';
      }
    },

    async readFile(path) {
      try {
        const result = await Filesystem.readFile({ path });
        const dataStr = typeof result.data === 'string' ? result.data : '';
        const binaryStr = atob(dataStr);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        return bytes;
      } catch (err) {
        console.warn('[platform-capacitor] readFile error:', err);
        return null;
      }
    },

    async readDirectory(path): Promise<DirEntry[]> {
      try {
        await Filesystem.requestPermissions();
        const result = await Filesystem.readdir({ path });
        return result.files.map((f) => ({
          name: f.name,
          path: f.uri,
          isDirectory: f.type === 'directory',
          isFile: f.type === 'file',
        }));
      } catch (err) {
        console.warn('[platform-capacitor] readDirectory error:', err);
        return [];
      }
    },

    async fileExists(path) {
      try {
        await Filesystem.stat({ path });
        return true;
      } catch {
        return false;
      }
    },

    async getFileStats(path) {
      try {
        const result = await Filesystem.stat({ path });
        return { size: result.size, modifiedAt: result.mtime ?? 0 };
      } catch {
        return null;
      }
    },

    async writeFile(path, data) {
      try {
        const binary = new TextDecoder('latin1').decode(data);
        const base64 = btoa(binary);
        await Filesystem.writeFile({
          path,
          data: base64,
        });
        return true;
      } catch (err) {
        console.warn('[platform-capacitor] writeFile error:', err);
        return false;
      }
    },

    async deleteFile(path) {
      try {
        await Filesystem.deleteFile({ path });
        return true;
      } catch {
        return false;
      }
    },

    async createDirectory(path) {
      try {
        await Filesystem.mkdir({ path, recursive: true });
        return true;
      } catch {
        return false;
      }
    },

    async renameFile(oldPath, newPath) {
      try {
        await Filesystem.rename({ from: oldPath, to: newPath });
        return true;
      } catch {
        return false;
      }
    },

    async getSetting(key) {
      try {
        const raw = localStorage.getItem(`ytmusic:${key}`);
        if (raw === null) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    async setSetting(key, value) {
      try {
        localStorage.setItem(
          `ytmusic:${key}`,
          typeof value === 'string' ? value : JSON.stringify(value),
        );
      } catch (err) {
        console.warn('[platform-capacitor] setSetting error:', err);
      }
    },

    onCookiesInvalid(_callback) {
      return () => {};
    },
  };
}
