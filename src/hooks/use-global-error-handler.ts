import { useEffect } from "react";
import { useToastStore } from "../stores/toast.store";

export function useGlobalErrorHandler() {
  useEffect(() => {
    function onRejection(event: PromiseRejectionEvent) {
      const msg = event.reason?.message || event.reason || "Unknown error";
      useToastStore.getState().toast(`Falha: ${msg}`, "danger");
    }

    function onError(event: ErrorEvent) {
      const msg = event.error?.message || event.message || "Unknown error";
      if (!event.filename?.includes("opencode") && !event.filename?.includes("chrome-extension")) {
        useToastStore.getState().toast(`Falha: ${msg}`, "danger");
      }
    }

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);
}
