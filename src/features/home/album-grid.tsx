import { Album } from "../../types/domain-types";
import { CoverImage } from "../../components/ui/art-image";
import { Button } from "../../components/ui/button";
import { Play } from "lucide-react";

interface AlbumGridProps {
  albums: Album[];
  onPlayAlbum: (album: Album) => void;
  onNavigateAlbum: (album: Album) => void;
}

export function AlbumGrid({ albums, onPlayAlbum, onNavigateAlbum }: AlbumGridProps) {
  if (albums.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {albums.map((album) => (
        <div
          key={album.id}
          className="group cursor-pointer rounded-lg p-2 transition-colors hover:bg-accent/50"
          onClick={() => onNavigateAlbum(album)}
        >
          <div className="relative mb-2">
            <CoverImage
              src={album.imageUrl}
              alt={album.name}
              fallback={album.name.charAt(0).toUpperCase()}
              className="aspect-square w-full rounded-lg"
            />
            <Button
              size="icon"
              className="absolute bottom-2 right-2 h-9 w-9 rounded-full bg-primary shadow-lg opacity-0 transition-all group-hover:opacity-100 group-hover:translate-y-0 translate-y-2 hover:scale-105 hover:bg-primary/90"
              onClick={(e) => {
                e.stopPropagation();
                onPlayAlbum(album);
              }}
            >
              <Play className="h-4 w-4 fill-current" />
            </Button>
          </div>
          <h3 className="truncate text-sm font-medium">{album.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{album.albumArtistName}</p>
        </div>
      ))}
    </div>
  );
}
