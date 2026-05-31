export type DbSong = {
  id: string;
  path: string;
  name: string;
  artist_name: string;
  album_name: string | null;
  album_artist: string | null;
  track_number: number | null;
  disc_number: number | null;
  duration: number | null;
  bitrate: number | null;
  sample_rate: number | null;
  genre: string | null;
  year: number | null;
  file_size: number | null;
  file_extension: string | null;
  last_modified: number | null;
  added_at: number;
  updated_at: number;
  mbz_recording_id: string | null;
  mbz_track_id: string | null;
  mbz_album_id: string | null;
  mbz_release_group_id: string | null;
  mbz_artist_id: string | null;
};

export type ScanState = {
  root_folder: string;
  scan_status: string;
  total_files: number;
  scanned_files: number;
  current_dir: string;
  last_scanned_at: number | null;
  watcher_enabled: number;
};

export type DbArtist = {
  id: string;
  name: string;
  mbz_artist_id: string | null;
  biography: string | null;
  image_url: string | null;
  genres: string | null; // JSON array stored as string
  country: string | null;
  type: string | null;
  disambiguation: string | null;
  updated_at: number;
};

export type MbzMetadataCache = {
  key: string;
  data: string;
  cached_at: number;
};

export type MbzSearchCache = {
  key: string;
  data: string;
  expires_at: number;
};
