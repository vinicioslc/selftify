export const ARTWORK_PROVIDER_META: Record<string, { label: string; description: string; domain: string }> = {
  embedded: { label: "Embedded Tags", description: "Cover art extracted from file tags", domain: "local" },
  cover_art_archive: { label: "Cover Art Archive", description: "Official covers indexed by MusicBrainz", domain: "coverartarchive.org" },
  musicbrainz_release_group: { label: "MusicBrainz RG", description: "Release group → releases → CAA", domain: "musicbrainz.org" },
  itunes: { label: "iTunes Search", description: "Apple Music / iTunes Store album art", domain: "itunes.apple.com" },
  deezer: { label: "Deezer", description: "Deezer album covers", domain: "api.deezer.com" },
  discogs: { label: "Discogs", description: "Covers from Discogs community database", domain: "api.discogs.com" },
};
