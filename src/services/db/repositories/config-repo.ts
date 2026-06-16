import { query, exec } from "../database";

export function getConfig(key: string): string | null {
  const rows = query<{ value: string }>("SELECT value FROM config WHERE key = ?", [key]);
  return rows[0]?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  exec("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, value]);
}

export function deleteConfig(key: string): void {
  exec("DELETE FROM config WHERE key = ?", [key]);
}

export function getAllConfig(): Record<string, string> {
  const rows = query<{ key: string; value: string }>("SELECT key, value FROM config");
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return result;
}
