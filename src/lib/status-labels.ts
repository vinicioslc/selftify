import { OriginType } from "../types/domain-types";
import type { LocalScanStatus } from "../stores/local-library.store";

export const SCAN_STATUS_LABEL: Record<LocalScanStatus, string> = {
  idle: "Ready",
  scanning: "Scanning\u2026",
  paused: "Paused",
  done: "Complete",
  error: "Error",
};

export const ORIGIN_TYPE_LABEL: Record<string, string> = {
  [OriginType.JELLYFIN]: "Jellyfin",
  [OriginType.NAVIDROME]: "Navidrome",
  [OriginType.SUBISONIC]: "Subsonic",
  [OriginType.YOUTUBE_MUSIC]: "YouTube Music",
  [OriginType.LOCAL]: "Local",
};
