import type { Album } from "../types/domain-types";

export function invalidateAlbumCaches(_album: Album): void {
  // No-op — frontend não resolve mais covers
}
