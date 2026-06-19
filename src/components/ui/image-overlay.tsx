import { useEffect } from "react";
import { X } from "lucide-react";

type ImageOverlayProps = {
  src: string;
  alt: string;
  onClose: () => void;
};

export function ImageOverlay({ src, alt, onClose }: ImageOverlayProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-in fade-in-0 duration-200"
      onClick={onClose}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/70 transition-colors hover:bg-black/70 hover:text-white"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      <div
        className="flex aspect-square h-[90vh] max-h-[90vw] max-w-[90vw] items-center justify-center animate-in zoom-in-95 duration-200"
        onClick={onClose}
      >
        <img
          src={src}
          alt={alt}
          className="h-full w-full rounded-lg object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}
