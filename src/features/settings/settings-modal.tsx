import { Dialog, DialogContent } from "../../components/ui/dialog";
import { SettingsPage } from "./settings-page";

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: string;
};

export function SettingsModal({ open, onOpenChange, initialTab }: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col w-[90vw] max-w-none h-full max-h-[calc(100vh-var(--player-bar-height)*2-2rem)] p-0">
        <SettingsPage initialTab={initialTab} />
      </DialogContent>
    </Dialog>
  );
}
