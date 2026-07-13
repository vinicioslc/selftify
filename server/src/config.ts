import "dotenv/config";
import path from "path";

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function strEnv(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

export const config = {
  port: Number(process.env.PORT || 6189),
  libraryRoot: path.resolve(strEnv(process.env.LIBRARY_ROOT, "/music")),
  // null = allow ALL origins (no CORS barrier). Set CORS_ORIGINS env to a
  // comma-separated list to restrict to specific domains.
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  subsonicUser: strEnv(process.env.SUBSONIC_USER, "admin"),
  subsonicPassword: strEnv(process.env.SUBSONIC_PASSWORD, "admin"),
  // Navidrome URL for proxying cover art (optional, for Navidrome remote backends)
  navidromeUrl: strEnv(process.env.NAVIDROME_URL, ""),
  dbReadonly: boolEnv(process.env.DB_READONLY, false),
  serverVersion: "1.0.0",
  apiVersion: "1.16.1",
};

function parseCorsOrigins(value: string | undefined): string[] | null {
  if (!value) return null;
  const list = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

export type ServerConfig = typeof config;
