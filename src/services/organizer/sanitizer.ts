const MAX_COMPONENT_LENGTH = 200;

export function sanitizeForPath(name: string): string {
  if (!name) return "Unknown";
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return cleaned.slice(0, MAX_COMPONENT_LENGTH) || "Unknown";
}
