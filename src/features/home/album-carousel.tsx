import { useState, useEffect, useRef, useCallback } from "react";
import { Album } from "../../types/domain-types";
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
    }, 5000);
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
      className="relative mx-auto max-w-lg"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      <div className="overflow-hidden rounded-xl">
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {albums.map((album) => (
            <div key={album.id} className="min-w-0 w-full shrink-0">
              <div
                className="group relative cursor-pointer"
                onClick={() => onNavigateAlbum(album)}
              >
                <div className="relative mx-auto overflow-hidden rounded-xl bg-muted" style={{ maxHeight: "30vh", maxWidth: "30vh" }}>
                  {album.imageUrl ? (
                    <img
                      src={album.imageUrl}
                      alt={album.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      style={{ maxHeight: "30vh", maxWidth: "30vh" }}
                    />
                  ) : (
                    <div className="flex h-full min-h-[20vh] items-center justify-center" style={{ maxHeight: "30vh", maxWidth: "30vh" }}>
                      <span className="text-5xl text-muted-foreground/30">
                        {album.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="truncate text-base font-bold text-white md:text-lg">
                      {album.name}
                    </h3>
                    <p className="truncate text-xs text-white/80 md:text-sm">
                      {album.albumArtistName}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    className="absolute bottom-3 right-3 h-9 w-9 rounded-full bg-primary shadow-lg opacity-0 transition-all md:h-10 md:w-10 group-hover:translate-y-0 group-hover:opacity-100 translate-y-2 hover:scale-105"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayAlbum(album);
                    }}
                  >
                    <Play className="h-4 w-4 fill-current md:h-5 md:w-5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {albums.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {albums.map((_, i) => (
            <button
              key={i}
              className={`rounded-full transition-all duration-300 ${
                i === currentIndex
                  ? "h-2 w-6 bg-primary shadow-sm shadow-primary/50"
                  : "h-2 w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
              onClick={() => {
                setCurrentIndex(i);
                setIsPaused(true);
                setTimeout(() => setIsPaused(false), 8000);
              }}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
