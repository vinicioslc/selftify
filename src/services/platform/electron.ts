import type { PlatformService, DirEntry } from './types';

export function createElectronPlatformService(): PlatformService {
  const api = () => (window as any).electronApi;

  return {
    isElectron: true,
    isAndroid: false,
    isWeb: false,

    async openFolderPicker() {
      return api()?.dialog?.openFolderPicker() ?? null;
    },

    async openFilePicker(options) {
      return api()?.dialog?.openFilePicker(options) ?? null;
    },

    async readFile(path) {
      return api()?.fs?.readFile(path) ?? null;
    },

    async readDirectory(path): Promise<DirEntry[]> {
      return api()?.fs?.readDirectory(path) ?? [];
    },

    async fileExists(path) {
      return api()?.fs?.fileExists(path) ?? false;
    },

    async getFileStats(path) {
      return api()?.fs?.getFileStats(path) ?? null;
    },

    async getSetting(key) {
      return api()?.settings?.get(key) ?? null;
    },

    async setSetting(key, value) {
      await api()?.settings?.set(key, value);
    },
  };
}
