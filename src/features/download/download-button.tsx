import { useCallback } from "react";
import { Button } from "../../components/ui/button";
import { useDownloadStore } from "../../stores/download.store";
import { DownloadStatus } from "../../types/domain-types";
import type { Song } from "../../types/domain-types";
import { Download, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { cn } from "../../lib/utils";

type DownloadButtonProps = {
  song: Song;
  variant?: "icon" | "button";
  size?: "sm" | "default";
  className?: string;
};

export function DownloadButton({ song, variant = "icon", size = "sm", className }: DownloadButtonProps) {
  const tasks = useDownloadStore((s) => s.tasks);
  const enqueueSong = useDownloadStore((s) => s.enqueueSong);
  const retryTask = useDownloadStore((s) => s.retryTask);
  const setPanelOpen = useDownloadStore((s) => s.setPanelOpen);

  const existingTask = tasks.find((t) => t.song.id === song.id);

  const handleClick = useCallback(() => {
    if (!existingTask) {
      enqueueSong(song);
    } else if (existingTask.status === DownloadStatus.FAILED) {
      retryTask(existingTask.id);
    } else {
      setPanelOpen(true);
    }
  }, [song, existingTask, enqueueSong, retryTask, setPanelOpen]);

  if (song.path) return null;

  const isDisabled = existingTask && existingTask.status !== DownloadStatus.FAILED && existingTask.status !== DownloadStatus.CANCELLED;

  const icon = () => {
    if (!existingTask) return <Download className="h-3.5 w-3.5" />;
    switch (existingTask.status) {
      case DownloadStatus.PENDING:
      case DownloadStatus.SEARCHING:
      case DownloadStatus.DOWNLOADING_AUDIO:
      case DownloadStatus.GETTING_COVER:
      case DownloadStatus.PROCESSING_COVER:
      case DownloadStatus.EMBEDDING_COVER:
        return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
      case DownloadStatus.COMPLETED:
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
      case DownloadStatus.FAILED:
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
      case DownloadStatus.CANCELLED:
        return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
      default:
        return <Download className="h-3.5 w-3.5" />;
    }
  };

  const tooltip = () => {
    if (!existingTask) return "Download";
    switch (existingTask.status) {
      case DownloadStatus.PENDING: return "In queue — click to view";
      case DownloadStatus.COMPLETED: return "Downloaded";
      case DownloadStatus.FAILED: return "Failed — click to retry";
      case DownloadStatus.CANCELLED: return "Cancelled";
      default: return "Downloading...";
    }
  };

  if (variant === "button") {
    return (
      <Button
        variant="outline"
        size={size}
        onClick={handleClick}
        disabled={isDisabled}
        className={cn("gap-1.5", className)}
        title={tooltip()}
      >
        {icon()}
        {existingTask?.status === DownloadStatus.COMPLETED ? "Downloaded" : "Download"}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7 text-muted-foreground hover:text-foreground", className)}
      onClick={handleClick}
      disabled={isDisabled}
      title={tooltip()}
    >
      {icon()}
    </Button>
  );
}
