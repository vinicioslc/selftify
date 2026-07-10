import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { FolderOpen, FolderClosed, Music, ArrowLeft, Home, Loader2 } from "lucide-react";
import { API_BASE } from "../../api/base";

interface DirEntry {
  name: string;
  path: string;
  hasAudio: boolean;
  audioCount: number;
}

interface BrowseResult {
  path: string;
  parent: string | null;
  isRoot: boolean;
  entries: DirEntry[];
}

interface LibraryBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  currentPath: string;
}

export function LibraryBrowserDialog({ open, onOpenChange, onSelect, currentPath }: LibraryBrowserDialogProps) {
  const [currentDir, setCurrentDir] = useState(currentPath || "");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isRoot, setIsRoot] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState(currentPath);

  const browse = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/selftify/browse?path=${encodeURIComponent(dir)}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to read directory");
        setLoading(false);
        return;
      }
      const data: BrowseResult = await res.json();
      setCurrentDir(data.path);
      setEntries(data.entries);
      setParentPath(data.parent);
      setIsRoot(data.isRoot);
    } catch {
      setError("Server not reachable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      browse(currentPath || "");
    }
  }, [open, currentPath, browse]);

  function handleNavigate(dirPath: string) {
    browse(dirPath);
  }

  function handleGoUp() {
    if (parentPath) browse(parentPath);
  }

  function handleSelect(dirPath: string) {
    setSelectedPath(dirPath);
  }

  function handleConfirm() {
    onSelect(selectedPath || currentDir);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Select Music Library Folder</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b pb-2">
          {!isRoot && (
            <Button variant="ghost" size="icon" onClick={handleGoUp} title="Go up">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => browse(isRoot ? currentDir : "/")} title="Root">
            <Home className="h-4 w-4" />
          </Button>
          <div className="flex-1 truncate text-sm font-mono text-muted-foreground">
            {currentDir}
          </div>
        </div>

        <ScrollArea className="h-[350px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-destructive">{error}</p>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No folders found</p>
          ) : (
            <div className="space-y-1 py-2">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                    selectedPath === entry.path ? "bg-accent font-medium" : ""
                  }`}
                  onClick={() => handleSelect(entry.path)}
                  onDoubleClick={() => handleNavigate(entry.path)}
                >
                  {entry.hasAudio ? (
                    <FolderOpen className="h-5 w-5 shrink-0 text-amber-500" />
                  ) : (
                    <FolderClosed className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">{entry.name}</span>
                  {entry.hasAudio && (
                    <span className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground">
                      <Music className="h-3 w-3" />
                      {entry.audioCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center gap-2 border-t pt-3">
          <Input
            className="flex-1 font-mono text-sm"
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
          />
          <Button onClick={handleConfirm} disabled={!selectedPath}>
            Select Folder
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
