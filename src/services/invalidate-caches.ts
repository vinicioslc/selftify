import type { Album } from "../types/domain-types";
import { clearCoverCache } from "../hooks/use-cover";
import { emitCoverUpdate } from "../services/cover-event-bus";

export function invalidateAlbumCaches(album: Album): void {
  clearCoverCache(
    album.albumArtistName,
    album.name,
    album.mbzArtistId,
    album.mbzReleaseGroupId,
    album.mbzId,
  );

  emitCoverUpdate(
    album.albumArtistName,
    album.name,
    album.mbzArtistId,
    album.mbzReleaseGroupId,
    album.mbzId,
  );
}
