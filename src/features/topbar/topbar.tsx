import { useStatusStore } from "../../stores/status.store";
import { useElectronWindow } from "../../hooks/use-electron-window";
import { Popover, PopoverTrigger, PopoverContent } from "../../components/ui/popover";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Minus, Square, X, Minimize2 } from "lucide-react";
import type { StatusLevel, StatusMessage } from "../../types/status-types";

const levelConfig: Record<StatusLevel, { label: string; dot: string }> = {
  info: { label: "Info", dot: "bg-blue-500" },
  success: { label: "Success", dot: "bg-green-500" },
  warn: { label: "Warn", dot: "bg-amber-500" },
  danger: { label: "Danger", dot: "bg-red-500" },
};

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function StatusDot({ level }: { level: StatusLevel }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${levelConfig[level].dot}`}
    />
  );
}

export function TopBar() {
  const messages = useStatusStore((s) => s.messages);
  const clearMessages = useStatusStore((s) => s.clearMessages);
  const { isElectron, isMaximized, minimize, maximize, close } =
    useElectronWindow();

  const latest = messages.length > 0 ? messages[messages.length - 1] : null;
  const reversed = [...messages].reverse();

  return (
    <div
      className="topbar flex items-center h-[38px] px-3 bg-background border-b select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left: identity */}
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/70 shrink-0">
        <span className="text-primary font-semibold tracking-wide">Selftify</span>
      </div>

      {/* Center: status */}
      <div className="flex-1 flex justify-center min-w-0 px-4">
        <Popover>
          <PopoverTrigger asChild>
            <button
              data-no-drag
              className="flex items-center gap-2 text-xs text-foreground/60 hover:text-foreground/80 transition-colors max-w-full"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              aria-label="Open status message history"
            >
              {latest ? (
                <>
                  <StatusDot level={latest.level} />
                  <span className="truncate">{latest.text}</span>
                </>
              ) : (
                <span className="text-muted-foreground italic">All clear</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            sideOffset={6}
            className="w-96 p-0"
            data-no-drag
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm font-medium">Status History</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearMessages}
                className="h-7 text-xs"
              >
                Clear
              </Button>
            </div>
            {reversed.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-6 text-center">
                No messages yet
              </p>
            ) : (
              <ScrollArea className="max-h-[320px]">
                {reversed.map((msg) => (
                  <HistoryRow key={msg.id} message={msg} />
                ))}
              </ScrollArea>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Right: window controls */}
      <div className="flex items-center gap-0.5 shrink-0">
        {isElectron && (
          <>
            <WindowButton
              aria-label="Minimize"
              onClick={minimize}
              data-no-drag
            >
              <Minus className="h-3.5 w-3.5" />
            </WindowButton>
            <WindowButton
              aria-label={isMaximized ? "Restore" : "Maximize"}
              onClick={maximize}
              data-no-drag
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
            </WindowButton>
            <WindowButton
              aria-label="Close"
              onClick={close}
              danger
              data-no-drag
            >
              <X className="h-3.5 w-3.5" />
            </WindowButton>
          </>
        )}
      </div>
    </div>
  );
}

function WindowButton({
  children,
  danger,
  ...props
}: React.ComponentPropsWithoutRef<typeof Button> & { danger?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-7 w-7 rounded-none hover:bg-accent ${
        danger
          ? "hover:bg-red-600 hover:text-white"
          : "hover:bg-accent"
      }`}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      {...props}
    >
      {children}
    </Button>
  );
}

function HistoryRow({ message }: { message: StatusMessage }) {
  const { level, text, source, timestamp } = message;
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 border-b last:border-b-0 hover:bg-accent/40 transition-colors">
      <StatusDot level={level} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {levelConfig[level].label}
          </span>
          <span className="text-xs text-muted-foreground/60">
            {relativeTime(timestamp)}
          </span>
        </div>
        <p className="text-sm text-foreground/80 truncate">{text}</p>
        {source && (
          <span className="text-xs text-muted-foreground/60">{source}</span>
        )}
      </div>
    </div>
  );
}
