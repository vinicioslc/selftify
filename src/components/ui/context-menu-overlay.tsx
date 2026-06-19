import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { ZIndex } from "../../lib/z-index";

type ContextMenuOverlayProps = {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
};

export function ContextMenuOverlay({ open, x, y, onClose, children }: ContextMenuOverlayProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex: ZIndex.ContextMenu }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onClose}
    >
      <div className="absolute" style={{ left: x, top: y }}>
        <DropdownMenu open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
          <DropdownMenuTrigger asChild>
            <span className="absolute w-px h-px" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            className="min-w-[180px]"
            style={{ zIndex: ZIndex.ContextMenu }}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
