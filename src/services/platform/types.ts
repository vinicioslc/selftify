export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface PlatformService {
  readonly isElectron: boolean;
  readonly isAndroid: boolean;
  readonly isWeb: boolean;

  openFolderPicker(): Promise<string | null>;
  openFilePicker(options?: { properties?: string[] }): Promise<string | null>;

  readFile(path: string): Promise<Uint8Array | null>;
  readDirectory(path: string): Promise<DirEntry[]>;
  fileExists(path: string): Promise<boolean>;
  getFileStats(path: string): Promise<{ size: number; modifiedAt: number } | null>;

  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  deleteFile(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<boolean>;
  renameFile(oldPath: string, newPath: string): Promise<boolean>;

  getSetting(key: string): Promise<any>;
  setSetting(key: string, value: any): Promise<void>;

  onCookiesInvalid(callback: () => void): () => void;
}
