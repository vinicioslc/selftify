const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".wma", ".opus", ".aiff", ".alac",
]);

export function isAudioFile(name: string): boolean {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  return AUDIO_EXTENSIONS.has(ext);
}

export function fileIdFromPath(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `local_${Math.abs(hash).toString(36)}`;
}

export function guessMetadataFromPath(
  relativePath: string
): { artistName: string; albumName: string | null; name: string } {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  const fileName = parts.pop() || relativePath;
  const name = fileName.replace(/\.[^/.]+$/, "").trim();

  let artistName = "Unknown Artist";
  let albumName: string | null = null;

  if (parts.length >= 2) {
    artistName = parts[0];
    albumName = parts[1];
  } else if (parts.length === 1) {
    albumName = parts[0];
  }

  return { artistName, albumName, name };
}

export const SCAN_STATUS_LABEL: Record<string, string> = {
  idle: "Ready",
  scanning: "Scanning\u2026",
  paused: "Paused",
  done: "Complete",
  error: "Error",
};
