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
      const result = await api()?.fs?.readFile(path);
      if (!result) return null;
      return result instanceof Uint8Array ? result : new Uint8Array(result);
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

    async writeFile(path, data) {
      return api()?.fs?.writeFile(path, Array.from(data)) ?? false;
    },

    async deleteFile(path) {
      return api()?.fs?.deleteFile(path) ?? false;
    },

    async createDirectory(path) {
      return api()?.fs?.createDirectory(path) ?? false;
    },

    async renameFile(oldPath, newPath) {
      return api()?.fs?.renameFile(oldPath, newPath) ?? false;
    },

    async getSetting(key) {
      return api()?.settings?.get(key) ?? null;
    },

    async setSetting(key, value) {
      await api()?.settings?.set(key, value);
    },

    onCookiesInvalid(callback) {
      const apiInstance = api();
      return apiInstance?.onCookiesInvalid?.(callback) ?? (() => {});
    },
  };
}
