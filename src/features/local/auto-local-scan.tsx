import { useEffect, useRef } from "react";
import { useAuthStore } from "../../stores/auth.store";
import { useLocalScan } from "../../hooks/use-local-scan";
import { OriginType } from "../../types/domain-types";

/**
 * Auto-triggers local file scanning when the app starts or when a LOCAL
 * origin is loaded/switched.  Lives at the App root so indexing starts
 * without requiring the user to navigate to LocalPage first.
 */
export function AutoLocalScan() {
  const { currentOrigin } = useAuthStore();
  const { autoScan } = useLocalScan();
  const lastOriginIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentOrigin || currentOrigin.type !== OriginType.LOCAL) return;
    if (lastOriginIdRef.current === currentOrigin.id) return;
    lastOriginIdRef.current = currentOrigin.id;

    const folder = currentOrigin.folderPath;
    if (!folder) return;

    autoScan(folder).catch((err) =>
      console.warn("[AutoLocalScan]", err),
    );
  }, [currentOrigin, autoScan]);

  return null;
}
