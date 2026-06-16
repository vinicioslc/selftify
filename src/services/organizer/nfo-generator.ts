export interface ArtistNfoParams {
  name: string;
  biography?: string | null;
  genres?: string[];
  mbid?: string | null;
  sortName?: string | null;
  type?: string | null;
  gender?: string | null;
  disambiguation?: string | null;
  formed?: string | null;
  born?: string | null;
  died?: string | null;
  disbanded?: string | null;
  yearsActive?: string | null;
  thumb?: string | null;
}

export interface AlbumNfoTrack {
  title: string;
  trackNumber?: number | null;
  duration?: number | null;
  mbzRecordingId?: string | null;
  mbzTrackId?: string | null;
  discNumber?: number | null;
  artistName?: string | null;
}

export interface AlbumNfoParams {
  title: string;
  artist: string;
  year?: number | null;
  genres?: string[];
  mbzReleaseGroupId?: string | null;
  mbzAlbumId?: string | null;
  albumArtist?: string | null;
  albumArtistMbid?: string | null;
  releasedate?: string | null;
  type?: string | null;
  duration?: number | null;
  thumb?: string | null;
  tracks: AlbumNfoTrack[];
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function optionalTag(tag: string, value: string | null | undefined, indent = 2): string | null {
  if (value == null || value === "") return null;
  const spaces = "  ".repeat(indent);
  return `${spaces}<${tag}>${xmlEscape(String(value))}</${tag}>`;
}

export function generateArtistNfoXml(params: ArtistNfoParams): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<artist>",
  ];

  const push = (tag: string, value: string | null | undefined, indent = 2) => {
    const line = optionalTag(tag, value, indent);
    if (line) lines.push(line);
  };

  push("name", params.name);

  if (params.mbid) {
    lines.push(`  <musicBrainzArtistID>${xmlEscape(params.mbid)}</musicBrainzArtistID>`);
  }

  push("sortname", params.sortName);
  push("type", params.type);
  push("gender", params.gender);
  push("disambiguation", params.disambiguation);

  if (params.genres && params.genres.length > 0) {
    for (const genre of params.genres) {
      lines.push(`  <genre>${xmlEscape(genre)}</genre>`);
    }
  }

  push("yearsactive", params.yearsActive);
  push("born", params.born);
  push("formed", params.formed);
  push("biography", params.biography);
  push("died", params.died);
  push("disbanded", params.disbanded);

  if (params.thumb) {
    lines.push(`  <thumb>${xmlEscape(params.thumb)}</thumb>`);
  }

  lines.push("</artist>");
  return lines.join("\n");
}

export function generateAlbumNfoXml(params: AlbumNfoParams): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<album>",
  ];

  const push = (tag: string, value: string | null | undefined, indent = 2) => {
    const line = optionalTag(tag, value, indent);
    if (line) lines.push(line);
  };

  push("title", params.title);
  push("artist", params.artist);
  push("musicbrainzalbumid", params.mbzAlbumId);
  push("musicbrainzreleasegroupid", params.mbzReleaseGroupId);

  if (params.year) {
    lines.push(`  <year>${params.year}</year>`);
  }

  const releasedate = params.releasedate || (params.year ? String(params.year) : null);
  push("releasedate", releasedate);

  if (params.genres && params.genres.length > 0) {
    for (const genre of params.genres) {
      lines.push(`  <genre>${xmlEscape(genre)}</genre>`);
    }
  }

  push("type", params.type);

  if (params.duration) {
    const secs = Math.round(params.duration / 1000);
    lines.push(`  <duration>${secs}</duration>`);
  }

  if (params.thumb) {
    lines.push(`  <thumb>${xmlEscape(params.thumb)}</thumb>`);
  }

  const albumArtist = params.albumArtist || params.artist;
  if (albumArtist) {
    if (params.albumArtistMbid) {
      lines.push("  <albumArtistCredits>");
      lines.push(`    <artist>${xmlEscape(albumArtist)}</artist>`);
      lines.push(`    <musicBrainzArtistID>${xmlEscape(params.albumArtistMbid)}</musicBrainzArtistID>`);
      lines.push("  </albumArtistCredits>");
    } else {
      lines.push("  <albumArtistCredits>");
      lines.push(`    <artist>${xmlEscape(albumArtist)}</artist>`);
      lines.push("  </albumArtistCredits>");
    }
  }

  if (params.tracks.length > 0) {
    for (const track of params.tracks) {
      lines.push("  <track>");
      push("title", track.title, 3);
      if (track.trackNumber) {
        lines.push(`    <tracknum>${track.trackNumber}</tracknum>`);
        lines.push(`    <position>${track.trackNumber}</position>`);
      }
      if (track.discNumber) {
        lines.push(`    <discnumber>${track.discNumber}</discnumber>`);
      }
      if (track.duration) {
        const secs = Math.round(track.duration / 1000);
        lines.push(`    <duration>${secs}</duration>`);
      }
      push("musicBrainzTrackID", track.mbzTrackId, 3);
      push("artist", track.artistName, 3);
      lines.push("  </track>");
    }
  }

  lines.push("</album>");
  return lines.join("\n");
}
