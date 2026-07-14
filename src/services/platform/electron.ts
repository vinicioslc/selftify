import type { PlatformService, DirEntry } from "./types";

export function createElectronPlatformService(): PlatformService {
  const api = (window as any).electronApi;

  return {
    isElectron: true,
    isAndroid: false,
    isWeb: false,

    async openFolderPicker() {
      return api?.dialog?.openFolder?.() ?? null;
    },

    async openFilePicker() {
      return api?.dialog?.openFile?.() ?? null;
    },

    async readFile(path: string) {
      return api?.fs?.readFile?.(path) ?? null;
    },

    async readDirectory(path: string) {
      return api?.fs?.readDirectory?.(path) ?? [];
    },

    async fileExists(path: string) {
      return api?.fs?.fileExists?.(path) ?? false;
    },

    async getFileStats(path: string) {
      return api?.fs?.getFileStats?.(path) ?? null;
    },

    async writeFile(path: string, data: Uint8Array) {
      return api?.fs?.writeFile?.(path, data) ?? false;
    },

    async deleteFile(path: string) {
      return api?.fs?.deleteFile?.(path) ?? false;
    },

    async createDirectory(path: string) {
      return api?.fs?.createDirectory?.(path) ?? false;
    },

    async renameFile(oldPath: string, newPath: string) {
      return api?.fs?.renameFile?.(oldPath, newPath) ?? false;
    },

    async getSetting(key: string) {
      return api?.settings?.get?.(key) ?? null;
    },

    async setSetting(key: string, value: any) {
      return api?.settings?.set?.(key, value);
    },

    onCookiesInvalid(callback: () => void) {
      api?.onCookiesInvalid?.(callback);
      return () => {};
    },
  };
}
