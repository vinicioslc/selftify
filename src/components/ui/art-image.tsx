import { useState, useEffect, useCallback, forwardRef } from "react";
import { cn } from "../../lib/utils";
import { Loader2 } from "lucide-react";

export type CoverImageProps = {
  src?: string | null;
  alt?: string;
  fallback?: string;
  className?: string;
  emptySvg?: React.ReactNode;
  onClick?: () => void;
  lazy?: boolean;
  onLazyLoad?: () => void;
};

export const CoverImage = forwardRef<HTMLDivElement, CoverImageProps>(
  ({ src, alt, fallback, className, emptySvg, onClick, lazy, onLazyLoad }, ref) => {
    const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
    const [hoverTriggered, setHoverTriggered] = useState(false);

    const isLazyPending = lazy && !hoverTriggered && !src;

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

    const handleMouseEnter = useCallback(() => {
      if (isLazyPending) {
        setHoverTriggered(true);
        setStatus("loading");
        onLazyLoad?.();
      }
    }, [isLazyPending, onLazyLoad]);

    const handleClick = useCallback(() => {
      if (isLazyPending) {
        setHoverTriggered(true);
        setStatus("loading");
        onLazyLoad?.();
      }
      onClick?.();
    }, [isLazyPending, onClick, onLazyLoad]);

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-md",
          className,
        )}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        role={onClick || isLazyPending ? "button" : undefined}
        tabIndex={onClick || isLazyPending ? 0 : undefined}
      >
        {isLazyPending ? (
          <div className="flex h-full w-full items-center justify-center bg-muted/50 transition-colors hover:bg-muted">
            {emptySvg || (
              <span className="text-xs font-medium text-muted-foreground">
                {fallback || alt?.charAt(0)?.toUpperCase() || "?"}
              </span>
            )}
          </div>
        ) : status === "loaded" && src ? (
          <img
            src={src}
            alt={alt || ""}
            className="aspect-square h-full w-full object-cover"
            onLoad={handleLoad}
            onError={handleError}
          />
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
