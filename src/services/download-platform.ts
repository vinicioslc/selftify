type ElectronApi = {
  yt: {
    downloadMp3: (request: {
      videoId: string;
      downloadFolder: string;
      metadata: {
        title: string;
        artist: string;
        album?: string;
        albumArtist?: string;
        trackNumber?: number;
        discNumber?: number;
        releaseYear?: number;
        genres?: string[];
      };
    }) => Promise<string>;
    processCover: (request: { imageData: number[]; outputDir: string }) => Promise<string | null>;
    embedArtwork: (request: {
      audioPath: string;
      coverPath: string;
      metadata?: {
        title: string;
        artist: string;
        album?: string;
        albumArtist?: string;
        trackNumber?: number;
        discNumber?: number;
        releaseYear?: number;
        genres?: string[];
        mbzRecordingId?: string;
        mbzArtistId?: string;
      };
    }) => Promise<void>;
  };
  fs: {
    deleteFile: (path: string) => Promise<boolean>;
    fileExists: (path: string) => Promise<boolean>;
  };
};

function getElectronApi(): ElectronApi | null {
  const api = (window as any).electronApi;
  if (!api?.yt?.downloadMp3) return null;
  return api as ElectronApi;
}

export interface DownloadPlatform {
  readonly supportsAudioConversion: boolean;
  readonly supportsCoverEmbedding: boolean;

  downloadAudio(params: {
    videoId: string;
    songName: string;
    artistName: string;
    albumName?: string;
    trackNumber?: number;
    discNumber?: number;
    releaseYear?: number;
    genres?: string[];
    downloadFolder: string;
  }): Promise<string>;

  processCover(params: {
    imageData: number[];
    outputDir: string;
  }): Promise<string | null>;

  embedCover(params: {
    audioPath: string;
    coverPath: string;
    metadata?: {
      title: string;
      artist: string;
      album?: string;
      albumArtist?: string;
      trackNumber?: number;
      discNumber?: number;
      releaseYear?: number;
      genres?: string[];
      mbzRecordingId?: string;
      mbzArtistId?: string;
    };
  }): Promise<void>;

  deleteFile(path: string): Promise<boolean>;
  fileExists(path: string): Promise<boolean>;
}

class ElectronDownloadPlatform implements DownloadPlatform {
  readonly supportsAudioConversion = true;
  readonly supportsCoverEmbedding = true;

  async downloadAudio(params: {
    videoId: string;
    songName: string;
    artistName: string;
    albumName?: string;
    trackNumber?: number;
    discNumber?: number;
    releaseYear?: number;
    genres?: string[];
    downloadFolder: string;
  }): Promise<string> {
    const api = getElectronApi();
    if (!api) throw new Error("Electron API not available");
    return api.yt.downloadMp3({
      videoId: params.videoId,
      downloadFolder: params.downloadFolder,
      metadata: {
        title: params.songName,
        artist: params.artistName,
        album: params.albumName,
        trackNumber: params.trackNumber,
        discNumber: params.discNumber,
        releaseYear: params.releaseYear,
        genres: params.genres,
      },
    });
  }

  async processCover(params: { imageData: number[]; outputDir: string }): Promise<string | null> {
    const api = getElectronApi();
    if (!api) return null;
    return api.yt.processCover({ imageData: params.imageData, outputDir: params.outputDir });
  }

  async embedCover(params: {
    audioPath: string;
    coverPath: string;
    metadata?: {
      title: string;
      artist: string;
      album?: string;
      albumArtist?: string;
      trackNumber?: number;
      discNumber?: number;
      releaseYear?: number;
      genres?: string[];
      mbzRecordingId?: string;
      mbzArtistId?: string;
    };
  }): Promise<void> {
    const api = getElectronApi();
    if (!api) return;
    await api.yt.embedArtwork(params);
  }

  async deleteFile(path: string): Promise<boolean> {
    const api = getElectronApi();
    if (!api) return false;
    return api.fs.deleteFile(path);
  }

  async fileExists(path: string): Promise<boolean> {
    const api = getElectronApi();
    if (!api) return false;
    return api.fs.fileExists(path);
  }
}

class WebDownloadPlatform implements DownloadPlatform {
  readonly supportsAudioConversion = false;
  readonly supportsCoverEmbedding = false;

  async downloadAudio(): Promise<string> {
    throw new Error("Download is not supported in web/mobile mode yet");
  }

  async processCover(): Promise<string | null> {
    return null;
  }

  async embedCover(): Promise<void> {
    // no-op
  }

  async deleteFile(): Promise<boolean> {
    return false;
  }

  async fileExists(): Promise<boolean> {
    return false;
  }
}

let platformInstance: DownloadPlatform | null = null;

export function getDownloadPlatform(): DownloadPlatform {
  if (platformInstance) return platformInstance;
  if (getElectronApi()) {
    platformInstance = new ElectronDownloadPlatform();
  } else {
    platformInstance = new WebDownloadPlatform();
  }
  return platformInstance;
}

export function resetDownloadPlatform(): void {
  platformInstance = null;
}
