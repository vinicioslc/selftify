import { useState } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../components/ui/dialog";

type CookieEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CookieEditDialog({ open, onOpenChange }: CookieEditDialogProps) {
  const origin = useAuthStore((s) => s.currentOrigin);
  const updateOrigin = useAuthStore((s) => s.updateOrigin);
  const [cookieValue, setCookieValue] = useState(origin?.youtubeMusicHeaders ?? "");

  if (!origin) return null;
  const currentOrigin = origin;

  function handleSave() {
    updateOrigin(currentOrigin.id, {
      youtubeMusicHeaders: cookieValue || undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Update YouTube Cookies</DialogTitle>
          <DialogDescription>
            Your YouTube cookies have expired. Paste the new Netscape cookie file content or
            browser headers below for &ldquo;{currentOrigin.name}&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <label className="text-sm font-medium">YouTube Cookies / Headers</label>
          <Textarea
            className="min-h-[200px] font-mono text-xs"
            placeholder={`# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1700000000\tSAPISID\thash...\n\nOr paste browser headers:\ncookie: abc123\nauthorization: SAPISIDHASH...`}
            value={cookieValue}
            onChange={(e) => setCookieValue(e.target.value)}
          />
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
