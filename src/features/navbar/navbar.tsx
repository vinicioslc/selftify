import { Button } from "../../components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";

type NavBarProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
};

export function NavBar({ canGoBack, canGoForward, onBack, onForward }: NavBarProps) {
  return (
    <div className="flex items-center gap-0.5 px-1 shrink-0">
      <Button variant="ghost" size="icon" disabled={!canGoBack} onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" disabled={!canGoForward} onClick={onForward}>
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
