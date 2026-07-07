export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function joinPaths(root: string, ...parts: string[]): string {
  const normalized = [root, ...parts].map(normalizePath);
  return normalized.join("/");
}

export function fileNameFromPath(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  return normalized.split("/").pop() || "unknown";
}

export function dirNameFromPath(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(0, idx) : ".";
}

export function toRelativePath(root: string, fullPath: string): string {
  const nRoot = normalizePath(root);
  const nFull = normalizePath(fullPath);
  if (!nFull.startsWith(nRoot)) return nFull;
  return nFull.slice(nRoot.length).replace(/^\//, "");
}

export function isAbsolutePath(p: string): boolean {
  return /^(?:[A-Za-z]:[/\\]|\/|\\\\[^\\])/.test(p);
}

export function stripTrailingSlash(p: string): string {
  return p.replace(/[/\\]+$/, "");
}

export function splitPath(p: string): string[] {
  return p.replace(/\\/g, "/").split("/").filter(Boolean);
}
