import { CoverImage } from "../../components/ui/art-image";
import type { Song } from "../../types/domain-types";

type SongCoverImageProps = {
  song: Song;
  alt?: string;
  fallback?: string;
  className?: string;
};

export function SongCoverImage({ song, alt, fallback, className }: SongCoverImageProps) {
  return (
    <CoverImage
      src={song.imageUrl ?? null}
      alt={alt || song.name}
      fallback={fallback || song.name.charAt(0)}
      className={className}
      lazy={!song.imageUrl}
    />
  );
}
