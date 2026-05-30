import { useCallback, useRef, useEffect } from "react";
import { cn } from "../../lib/utils";

interface ResizeHandleProps {
  onResize: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
}

export function ResizeHandle({ onResize, minWidth = 220, maxWidth, className }: ResizeHandleProps) {
  const dragRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width") || "280"
    );
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const delta = e.clientX - startXRef.current;
      const effectiveMax = maxWidth ?? window.innerWidth * 0.5;
      const newWidth = Math.min(effectiveMax, Math.max(minWidth, startWidthRef.current + delta));
      document.documentElement.style.setProperty("--sidebar-width", `${newWidth}px`);
      onResize(newWidth);
    }

    function handleMouseUp() {
      if (dragRef.current) {
        dragRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onResize, minWidth, maxWidth]);

  return (
    <div
      className={cn(
        "absolute right-0 top-0 z-50 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/40",
        className
      )}
      onMouseDown={handleMouseDown}
    />
  );
}
