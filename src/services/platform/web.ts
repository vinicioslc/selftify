import type { PlatformService, DirEntry } from './types';

export function createWebPlatformService(): PlatformService {
  function getLocal(key: string): string | null {
    try {
      return localStorage.getItem(`ytmusic:${key}`);
    } catch {
      return null;
    }
  }

  function setLocal(key: string, value: string): void {
    try {
      localStorage.setItem(`ytmusic:${key}`, value);
    } catch {}
  }

  return {
    isElectron: false,
    isAndroid: false,
    isWeb: true,

    async openFolderPicker() {
      try {
        const input = document.createElement('input');
        input.type = 'file';
        (input as any).webkitdirectory = true;
        const files = await new Promise<File[]>((resolve, reject) => {
          input.onchange = () => resolve(Array.from(input.files || []));
          input.onerror = () => reject(new Error('No folder selected'));
          input.click();
        });
        if (files.length === 0) return null;
        return files[0].webkitRelativePath.split('/')[0] || files[0].name;
      } catch {
        return null;
      }
    },

    async openFilePicker(options) {
      try {
        const accept = options?.properties?.includes('openDirectory') ? undefined : 'audio/*';
        const input = document.createElement('input');
        input.type = 'file';
        if (options?.properties?.includes('openDirectory')) {
          (input as any).webkitdirectory = true;
        }
        if (accept) input.accept = accept;
        const files = await new Promise<FileList | null>((resolve, reject) => {
          input.onchange = () => resolve(input.files);
          input.onerror = () => reject(new Error('No file selected'));
          input.click();
        });
        if (!files || files.length === 0) return null;
        return files[0].name;
      } catch {
        return null;
      }
    },

    async readFile(path) {
      try {
        const resp = await fetch(path);
        const buf = await resp.arrayBuffer();
        return new Uint8Array(buf);
      } catch {
        return null;
      }
    },

    async readDirectory(_path): Promise<DirEntry[]> {
      return [];
    },

    async fileExists(_path) {
      return false;
    },

    async getFileStats(_path) {
      return null;
    },

    async getSetting(key) {
      const raw = getLocal(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },

    async setSetting(key, value) {
      setLocal(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
  };
}
