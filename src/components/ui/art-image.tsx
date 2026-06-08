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
};

export const CoverImage = forwardRef<HTMLDivElement, CoverImageProps>(
  ({ src, alt, fallback, className, emptySvg, onClick }, ref) => {
    const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

    useEffect(() => {
      if (src && src.startsWith("blob:")) {
        setStatus("loaded");
      } else if (src) {
        setStatus("loading");
      } else {
        setStatus("error");
      }
    }, [src]);

    const handleLoad = useCallback(() => setStatus("loaded"), []);
    const handleError = useCallback(() => {
      setStatus("error");
      console.warn("[CoverImage] failed to load:", src);
    }, [src]);

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-md",
          className,
        )}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        {status === "loaded" && src ? (
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
