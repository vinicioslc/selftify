import { useState } from "react";
import { Origin } from "../../types/domain-types";
import { useAuthStore } from "../../stores/auth.store";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../components/ui/dialog";

type OriginEditDialogProps = {
  origin: Origin;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OriginEditDialog({ origin, open, onOpenChange }: OriginEditDialogProps) {
  const updateOrigin = useAuthStore((s) => s.updateOrigin);
  const [form, setForm] = useState({
    name: origin.name,
    folderPath: origin.folderPath || "",
    downloadFolder: origin.downloadFolder || "",
    organizeOnScan: origin.organizeOnScan || false,
    organizeDryRun: origin.organizeDryRun || false,
  });

  function handleSave() {
    updateOrigin(origin.id, {
      name: form.name,
      folderPath: form.folderPath || undefined,
      downloadFolder: form.downloadFolder || undefined,
      organizeOnScan: form.organizeOnScan,
      organizeDryRun: form.organizeDryRun,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Source</DialogTitle>
          <DialogDescription>
            Update the configuration for &ldquo;{origin.name}&rdquo;
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Music Folder</label>
            <Input
              value={form.folderPath}
              onChange={(e) => setForm({ ...form, folderPath: e.target.value })}
              placeholder="/home/user/Music"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Download Folder</label>
            <Input
              value={form.downloadFolder}
              onChange={(e) => setForm({ ...form, downloadFolder: e.target.value })}
              placeholder="Same as music folder"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
