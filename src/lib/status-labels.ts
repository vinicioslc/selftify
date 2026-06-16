import { OriginType } from "../types/domain-types";

export type LocalScanStatus = "idle" | "scanning" | "paused" | "done" | "error";

export const SCAN_STATUS_LABEL: Record<LocalScanStatus, string> = {
  idle: "Ready",
  scanning: "Scanning\u2026",
  paused: "Paused",
  done: "Complete",
  error: "Error",
};

export const ORIGIN_TYPE_LABEL: Record<string, string> = {
  [OriginType.LOCAL]: "Local",
};
