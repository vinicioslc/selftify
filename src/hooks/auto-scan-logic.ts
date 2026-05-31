export type AutoScanAction = "start" | "resume" | "mark-done" | "skip";

export interface AutoScanInput {
  rootFolder: string;
  scanState: { scan_status: string } | null;
  queueCount: number;
  songCount: number;
}

export function decideAutoScan(input: AutoScanInput): AutoScanAction {
  const { rootFolder, scanState, queueCount, songCount } = input;

  if (scanState && (scanState.scan_status === "scanning" || scanState.scan_status === "paused")) {
    return queueCount > 0 ? "resume" : "mark-done";
  }

  // Re-scan if in-memory DB is empty but rootFolder is set (e.g. after page reload)
  if (rootFolder && (!scanState || scanState.scan_status === "done")) {
    if (songCount === 0) return "start";
  }

  if (scanState?.scan_status === "idle" && rootFolder) return "start";

  return "skip";
}
