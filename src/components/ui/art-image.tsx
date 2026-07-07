import { useState, useEffect, useCallback, forwardRef } from "react";
import { cn } from "../../lib/utils";
import { Loader2, Search } from "lucide-react";

export interface CoverImageSource {
  label: string;
  color: string;
}

const SOURCE_MAP: Record<string, CoverImageSource> = {
  "img-folder": { label: "Local", color: "bg-green-600" },
  "embedded":  { label: "Tags", color: "bg-blue-600" },
  "deezer":    { label: "Deezer", color: "bg-yellow-600" },
  "itunes":    { label: "iTunes", color: "bg-purple-600" },
  "local":     { label: "Local", color: "bg-green-600" },
  "remote":    { label: "Online", color: "bg-orange-600" },
};

function formatImageSource(source: string | null | undefined): CoverImageSource | null {
  if (!source || source === "none") return null;
  return SOURCE_MAP[source] || { label: source, color: "bg-gray-600" };
}

export type CoverImageProps = {
  src?: string | null;
  alt?: string;
  fallback?: string;
  className?: string;
  emptySvg?: React.ReactNode;
  onClick?: () => void;
  lazy?: boolean;
  onLazyLoad?: () => void;
  imageSource?: string | null;
};

export const CoverImage = forwardRef<HTMLDivElement, CoverImageProps>(
  ({ src, alt, fallback, className, emptySvg, onClick, lazy, onLazyLoad, imageSource }, ref) => {
    const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
    const [fetchStarted, setFetchStarted] = useState(false);

    const isLazyPending = lazy && !fetchStarted && !src;

    useEffect(() => {
      if (src && src.startsWith("blob:")) {
        setStatus("loaded");
      } else if (src) {
        setStatus("loading");
      } else if (!isLazyPending) {
        setStatus("error");
      }
    }, [src, isLazyPending]);

    const handleLoad = useCallback(() => setStatus("loaded"), []);
    const handleError = useCallback(() => {
      setStatus("error");
      console.warn("[CoverImage] failed to load:", src);
    }, [src]);

    const handleFetchClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      if (!fetchStarted) {
        setFetchStarted(true);
        setStatus("loading");
        onLazyLoad?.();
      }
    }, [fetchStarted, onLazyLoad]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (isLazyPending && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        handleFetchClick(e as unknown as React.MouseEvent);
      }
    }, [isLazyPending, handleFetchClick]);

    return (
      <div
        ref={ref}
        className={cn(
          "group relative flex h-10 w-10 shrink-0 overflow-hidden rounded-md aspect-square",
          className,
        )}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? handleKeyDown : undefined}
      >
        {isLazyPending ? (
          <div className="flex h-full w-full items-center justify-center bg-muted/50">
            {emptySvg || (
              <span className="text-xs font-medium text-muted-foreground">
                {fallback || alt?.charAt(0)?.toUpperCase() || "?"}
              </span>
            )}
            <button
              className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-white opacity-0 shadow-sm transition-opacity hover:bg-black/70 group-hover:opacity-100"
              onClick={handleFetchClick}
              title="Fetch cover from web"
              aria-label="Fetch cover from web"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : status === "loaded" && src ? (
          <>
            <img
              src={src}
              alt={alt || ""}
              className="aspect-square h-full w-full object-cover"
              onLoad={handleLoad}
              onError={handleError}
            />
            {(() => {
              const info = formatImageSource(imageSource);
              if (!info) return null;
              return (
                <div className="absolute bottom-1 left-1 z-10 rounded-sm px-1.5 py-0.5 text-[9px] font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                  <span className={cn("rounded-sm px-1 py-0.5", info.color)}>{info.label}</span>
                </div>
              );
            })()}
          </>
        ) : status === "loading" ? (
          <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : emptySvg ? (
          <div className="flex h-full w-full items-center justify-center bg-muted/50">
            {emptySvg}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-xs font-medium text-muted-foreground">
            {fallback || alt?.charAt(0)?.toUpperCase() || "?"}
          </div>
        )}
      </div>
    );
  },
);
CoverImage.displayName = "CoverImage";

/** @deprecated Use CoverImage instead */
export const ArtImage = CoverImage;
