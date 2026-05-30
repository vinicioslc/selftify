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

  getSetting(key: string): Promise<any>;
  setSetting(key: string, value: any): Promise<void>;
}
