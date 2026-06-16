import { useState } from "react";
import { Badge } from "./badge";
import { Button } from "./button";
import { Database, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

type Props = {
  visible: boolean;
  onClear?: () => void;
  label?: string;
};

export function CachedBadge({ visible, onClear, label = "Cached" }: Props) {
  const [open, setOpen] = useState(false);

  if (!visible) return null;

  if (!onClear) {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px] cursor-default">
        <Database className="h-3 w-3" />
        {label}
      </Badge>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="focus:outline-none">
          <Badge variant="secondary" className="gap-1 text-[10px] cursor-pointer hover:bg-secondary/80">
            <Database className="h-3 w-3" />
            {label}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        <DropdownMenuItem onClick={() => { onClear(); setOpen(false); }}>
          <Trash2 className="mr-2 h-4 w-4" />
          <span className="text-sm">Clear this cache</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
