import { useState } from "react";
import { Origin, OriginType } from "../../types/domain-types";
import { useAuthStore } from "../../stores/auth.store";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Switch } from "../../components/ui/switch";
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
    enableOnlineSearch: origin.enableOnlineSearch || false,
    musicBrainzToken: origin.musicBrainzToken || "",
    youtubeMusicHeaders: origin.youtubeMusicHeaders || "",
  });

  function handleSave() {
    updateOrigin(origin.id, {
      name: form.name,
      folderPath: form.folderPath || undefined,
      downloadFolder: form.downloadFolder || undefined,
      enableOnlineSearch: form.enableOnlineSearch,
      musicBrainzToken: form.musicBrainzToken || undefined,
      youtubeMusicHeaders: form.youtubeMusicHeaders || undefined,
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

          <div className="flex items-center gap-2 rounded-lg border p-3">
            <Switch
              id="edit-enable-online"
              checked={form.enableOnlineSearch}
              onCheckedChange={(v) => setForm({ ...form, enableOnlineSearch: v })}
            />
            <label htmlFor="edit-enable-online" className="text-sm font-medium leading-none">
              Enable Online Search
            </label>
          </div>

          {form.enableOnlineSearch && (
            <div className="space-y-4 rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Online Search Config</p>

              <div className="space-y-2">
                <label className="text-sm font-medium">MusicBrainz Token</label>
                <Input
                  value={form.musicBrainzToken}
                  onChange={(e) => setForm({ ...form, musicBrainzToken: e.target.value })}
                  placeholder="abc-123-def-456 (optional)"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">YouTube Headers</label>
                <Textarea
                  className="min-h-[80px] font-mono text-xs"
                  placeholder={"cookie: abc123\nauthorization: SAPISIDHASH..."}
                  value={form.youtubeMusicHeaders}
                  onChange={(e) => setForm({ ...form, youtubeMusicHeaders: e.target.value })}
                />
              </div>
            </div>
          )}
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
