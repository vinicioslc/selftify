import { useState, useEffect, useCallback } from "react";

type WindowControls = {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
};

export function useElectronWindow() {
  const api = (window as any).electronApi as
    | { windowControls: WindowControls & { isMaximized: () => Promise<boolean>; onMaximizeChange: (cb: (max: boolean) => void) => () => void } }
    | undefined;

  const isElectron = !!api?.windowControls;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!api?.windowControls) return;
    api.windowControls.isMaximized().then(setIsMaximized);
    return api.windowControls.onMaximizeChange(setIsMaximized);
  }, [api]);

  const minimize = useCallback(() => api?.windowControls.minimize(), [api]);
  const maximize = useCallback(() => api?.windowControls.maximize(), [api]);
  const close = useCallback(() => api?.windowControls.close(), [api]);

  return { isElectron, isMaximized, minimize, maximize, close };
}
