export type MusicBrainzResponse<T> = {
  created: string;
  count: number;
  offset: number;
  recordings?: T[];
  releases?: T[];
  artists?: T[];
};

export type MBRecording = {
  id: string;
  title: string;
  length?: number;
  video?: boolean;
  disambiguation?: string;
  artist?: string;
  "artist-credit"?: Array<{
    name: string;
    artist: { id: string; name: string };
  }>;
  releases?: MBRelease[];
};

export type MBRelease = {
  id: string;
  title: string;
  status?: string;
  "release-group"?: {
    id: string;
    "primary-type"?: string;
  };
  date?: string;
  "cover-art-archive"?: {
    artwork: boolean;
    front: boolean;
  };
  "artist-credit"?: Array<{
    name: string;
    artist: { id: string; name: string };
  }>;
  "media"?: Array<{
    format?: string;
    "track-count"?: number;
    tracks?: Array<{
      id: string;
      number?: string;
      title: string;
      length?: number;
      recording?: { id: string };
    }>;
  }>;
};

export type MusicBrainzReleaseGroupResponse = {
  created: string;
  count: number;
  offset: number;
  "release-groups"?: MBReleaseGroup[];
};

export type MBReleaseGroup = {
  id: string;
  title: string;
  "primary-type"?: string;
  "secondary-types"?: string[];
  "first-release-date"?: string;
  "artist-credit"?: Array<{
    name: string;
    artist: { id: string; name: string };
  }>;
};

export type MBArtist = {
  id: string;
  name: string;
  sortName?: string;
  disambiguation?: string;
  country?: string;
  type?: string;
  "life-span"?: { begin?: string; end?: string; ended?: boolean };
  tags?: Array<{ name: string; count: number }>;
};
