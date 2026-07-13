import { useCover } from "../../hooks/use-cover";
import { CoverImage } from "../../components/ui/art-image";
import type { Song } from "../../types/domain-types";

type SongCoverImageProps = {
  song: Song;
  alt?: string;
  fallback?: string;
  className?: string;
};

export function SongCoverImage({ song, alt, fallback, className }: SongCoverImageProps) {
  const { coverUrl, triggerRemote } = useCover(
    {
      artistName: song.artistName,
      albumName: song.albumName,
      mbzArtistId: song.mbzArtistId,
      mbzReleaseGroupId: song.mbzReleaseGroupId,
      mbzReleaseId: song.mbzAlbumId,
      imageUrl: song.imageUrl,
    },
  );

  const finalUrl = coverUrl;

  return (
    <CoverImage
      src={finalUrl}
      alt={alt || song.name}
      fallback={fallback || song.name.charAt(0)}
      className={className}
      lazy={!finalUrl}
      onLazyLoad={triggerRemote}
    />
  );
}
