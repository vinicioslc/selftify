import { useDownloadStore } from "../../stores/download.store";
import { DownloadStatus } from "../../types/domain-types";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { X, Loader2, CheckCircle2, AlertCircle, Clock, Trash2, RotateCcw } from "lucide-react";
import { cn } from "../../lib/utils";

const statusLabels: Record<string, string> = {
  [DownloadStatus.SEARCHING]: "Searching YouTube...",
  [DownloadStatus.DOWNLOADING_AUDIO]: "Downloading audio...",
  [DownloadStatus.GETTING_COVER]: "Fetching cover art...",
  [DownloadStatus.PROCESSING_COVER]: "Processing cover image...",
  [DownloadStatus.EMBEDDING_COVER]: "Embedding into MP3...",
};

export function DownloadQueuePanel() {
  const tasks = useDownloadStore((s) => s.tasks);
  const isPanelOpen = useDownloadStore((s) => s.isPanelOpen);
  const setPanelOpen = useDownloadStore((s) => s.setPanelOpen);
  const cancelTask = useDownloadStore((s) => s.cancelTask);
  const retryTask = useDownloadStore((s) => s.retryTask);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);

  const activeTasks = tasks.filter(
    (t) =>
      t.status === DownloadStatus.SEARCHING ||
      t.status === DownloadStatus.DOWNLOADING_AUDIO ||
      t.status === DownloadStatus.GETTING_COVER ||
      t.status === DownloadStatus.PROCESSING_COVER ||
      t.status === DownloadStatus.EMBEDDING_COVER,
  );
  const pendingTasks = tasks.filter((t) => t.status === DownloadStatus.PENDING);
  const completedTasks = tasks.filter((t) => t.status === DownloadStatus.COMPLETED);
  const failedTasks = tasks.filter((t) => t.status === DownloadStatus.FAILED);
  const cancelledTasks = tasks.filter((t) => t.status === DownloadStatus.CANCELLED);

  return (
    <Dialog open={isPanelOpen} onOpenChange={(open) => setPanelOpen(open)}>
      <DialogContent className="max-w-[520px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Download Queue</span>
            {activeTasks.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({activeTasks.length} active)
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {(completedTasks.length > 0 || cancelledTasks.length > 0) && (
          <div className="flex justify-end -mt-2 mb-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearCompleted}
              className="h-7 text-xs text-muted-foreground"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear Completed
            </Button>
          </div>
        )}

        <ScrollArea className="flex-1 -mx-6 px-6">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <DownloadIcon className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No downloads yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Download songs to keep them offline
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {activeTasks.length > 0 && (
                <SectionHeader label="In Progress" count={activeTasks.length} />
              )}
              {activeTasks.map((task) => (
                <TaskCard key={task.id} task={task} onCancel={cancelTask} onRetry={retryTask} />
              ))}

              {pendingTasks.length > 0 && (
                <SectionHeader label="Queued" count={pendingTasks.length} />
              )}
              {pendingTasks.map((task) => (
                <TaskCard key={task.id} task={task} onCancel={cancelTask} onRetry={retryTask} />
              ))}

              {failedTasks.length > 0 && (
                <SectionHeader label="Failed" count={failedTasks.length} />
              )}
              {failedTasks.map((task) => (
                <TaskCard key={task.id} task={task} onCancel={cancelTask} onRetry={retryTask} />
              ))}

              {completedTasks.length > 0 && (
                <SectionHeader label="Completed" count={completedTasks.length} />
              )}
              {completedTasks.map((task) => (
                <TaskCard key={task.id} task={task} onCancel={cancelTask} onRetry={retryTask} />
              ))}

              {cancelledTasks.length > 0 && (
                <SectionHeader label="Cancelled" count={cancelledTasks.length} />
              )}
              {cancelledTasks.map((task) => (
                <TaskCard key={task.id} task={task} onCancel={cancelTask} onRetry={retryTask} />
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {label} ({count})
    </div>
  );
}

function TaskCard({
  task,
  onCancel,
  onRetry,
}: {
  task: any;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const isActive =
    task.status === DownloadStatus.SEARCHING ||
    task.status === DownloadStatus.DOWNLOADING_AUDIO ||
    task.status === DownloadStatus.GETTING_COVER ||
    task.status === DownloadStatus.PROCESSING_COVER ||
    task.status === DownloadStatus.EMBEDDING_COVER;

  const isPending = task.status === DownloadStatus.PENDING;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        isActive && "border-primary/30 bg-accent/10",
        task.status === DownloadStatus.FAILED && "border-red-500/30 bg-red-500/5",
        task.status === DownloadStatus.COMPLETED && "border-green-500/20",
        (isPending || task.status === DownloadStatus.CANCELLED) && "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{task.song.name}</p>
          <p className="truncate text-xs text-muted-foreground">{task.song.artistName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {task.status === DownloadStatus.FAILED && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onRetry(task.id)}
              title="Retry"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          {(isActive || isPending) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onCancel(task.id)}
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {isActive && (
        <div className="mt-2 space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${task.progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {statusLabels[task.status] || task.stepLabel}
          </p>
        </div>
      )}

      {task.status === DownloadStatus.FAILED && task.error && (
        <p className="mt-1 text-xs text-red-500">{task.error}</p>
      )}

      {task.status === DownloadStatus.COMPLETED && task.completedAt && (
        <p className="mt-1 text-xs text-green-500">Completed</p>
      )}
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
