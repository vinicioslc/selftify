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
