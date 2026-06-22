import * as ToastPrimitive from "@radix-ui/react-toast";
import { useToastStore } from "../../stores/toast.store";
import { ToastView } from "./toast";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <ToastPrimitive.Provider swipeDirection="down">
      {toasts.map((t) => (
        <ToastView key={t.id} text={t.text} variant={t.variant} open onOpenChange={() => dismiss(t.id)} />
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-[calc(var(--player-bar-height)+16px)] left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 p-4 outline-none" />
    </ToastPrimitive.Provider>
  );
}
