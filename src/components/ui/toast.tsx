import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { cn } from "../../lib/utils";
import { X } from "lucide-react";
import type { ToastVariant } from "../../stores/toast.store";

const variantStyles: Record<ToastVariant, string> = {
  info: "border-border bg-background",
  success: "border-green-600 bg-green-950/90",
  warn: "border-amber-600 bg-amber-950/90",
  danger: "border-red-600 bg-red-950/90",
};

export function ToastView({
  text,
  variant,
  open,
  onOpenChange,
}: {
  text: string;
  variant: ToastVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ToastPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      duration={Infinity}
      className={cn(
        "pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full",
        variantStyles[variant],
      )}
    >
      <span className="flex-1 text-foreground/90">{text}</span>
      <ToastPrimitive.Close className="shrink-0 rounded-md p-1 text-foreground/60 transition-colors hover:text-foreground">
        <X className="h-4 w-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}
