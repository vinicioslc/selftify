export type FileTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  genres?: string[];
  year?: number;
  bpm?: number;
  composer?: string;
  lyrics?: string;
  comment?: string;
  coverArtRef?: { hash: string; format: "jpeg" | "png" | "webp" };
};
