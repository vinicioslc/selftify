import { useState, useEffect, useRef, useCallback } from "react";
import { Album } from "../../types/domain-types";
import { Avatar } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { Play } from "lucide-react";

interface AlbumCarouselProps {
  albums: Album[];
  onPlayAlbum: (album: Album) => void;
  onNavigateAlbum: (album: Album) => void;
}

export function AlbumCarousel({ albums, onPlayAlbum, onNavigateAlbum }: AlbumCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const startAutoPlay = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % albums.length);
    }, 3000);
  }, [albums.length]);

  useEffect(() => {
    if (albums.length > 1 && !isPaused) {
      startAutoPlay();
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [albums.length, isPaused, startAutoPlay]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [albums]);

  if (albums.length === 0) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      <div className="overflow-hidden rounded-lg">
        <div
          className="flex transition-transform duration-500 ease-in-out"
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {albums.map((album) => (
            <div key={album.id} className="min-w-0 w-full shrink-0">
              <div
                className="group relative cursor-pointer"
                onClick={() => onNavigateAlbum(album)}
              >
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                  {album.imageUrl ? (
                    <img
                      src={album.imageUrl}
                      alt={album.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="text-5xl text-muted-foreground/30">
                        {album.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6">
                    <h3 className="text-lg font-bold text-white md:text-2xl truncate">
                      {album.name}
                    </h3>
                    <p className="text-sm text-white/80 md:text-base truncate">
                      {album.albumArtistName}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    className="absolute bottom-4 right-4 h-10 w-10 rounded-full bg-primary shadow-lg opacity-0 transition-all md:h-12 md:w-12 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2 hover:scale-105"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayAlbum(album);
                    }}
                  >
                    <Play className="h-5 w-5 fill-current md:h-6 md:w-6" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {albums.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {albums.map((_, i) => (
            <button
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === currentIndex
                  ? "w-6 bg-primary"
                  : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
              onClick={() => {
                setCurrentIndex(i);
                setIsPaused(true);
                setTimeout(() => setIsPaused(false), 4000);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
