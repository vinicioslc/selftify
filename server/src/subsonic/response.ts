import type { Response } from "express";
import { config } from "../config";
import { SubsonicError, SubsonicErrorCode } from "./errors";

export interface SubsonicEnvelope {
  status: "ok" | "failed";
  version: string;
  type: string;
  serverVersion: string;
  openSubsonic: boolean;
  [key: string]: unknown;
}

function toXml(key: string, value: unknown, indent = 1): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) {
    return `${pad}<${key}/>`;
  }
  if (Array.isArray(value)) {
    // Subsonic plural arrays: e.g. "artist" inside "artists"
    const childTag = guessChildTag(key);
    return value.map((item) => `${pad}<${childTag}>\n${toXmlChildren(item, indent + 1)}\n${pad}</${childTag}>`).join("\n");
  }
  if (typeof value === "object") {
    return `${pad}<${key}>\n${toXmlChildren(value as Record<string, unknown>, indent + 1)}\n${pad}</${key}>`;
  }
  const escaped = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `${pad}<${key}>${escaped}</${key}>`;
}

function toXmlChildren(obj: Record<string, unknown>, indent: number): string {
  return Object.entries(obj)
    .map(([k, v]) => toXml(k, v, indent))
    .join("\n");
}

function guessChildTag(parent: string): string {
  if (parent === "artists") return "artist";
  if (parent === "albums") return "album";
  if (parent === "songs" || parent === "entry") return "song";
  if (parent === "playlists") return "playlist";
  if (parent === "musicFolders") return "musicFolder";
  if (parent === "indexes") return "index";
  return parent.replace(/s$/, "");
}

export function sendOk(res: Response, data: Record<string, unknown>, version: string): void {
  const format = (res.locals.format as string) || "json";
  const envelope = {
    status: "ok" as const,
    version,
    type: "selftify",
    serverVersion: config.serverVersion,
    openSubsonic: true,
    ...data,
  };
  if (format === "xml") {
    res.type("application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response status="ok" version="${version}" type="selftify" serverVersion="${config.serverVersion}" openSubsonic="true">\n${toXmlChildren(envelope, 1)}\n</subsonic-response>`);
    return;
  }
  res.json({ "subsonic-response": envelope });
}

export function sendError(res: Response, err: unknown, version: string): void {
  const format = (res.locals.format as string) || "json";
  const code = err instanceof SubsonicError ? err.code : SubsonicErrorCode.GENERIC;
  const message = err instanceof Error ? err.message : "Unknown error";
  const envelope = {
    status: "failed" as const,
    version,
    type: "selftify",
    serverVersion: config.serverVersion,
    openSubsonic: true,
    error: { code, message },
  };
  if (format === "xml") {
    res.type("application/xml");
    res.status(code === SubsonicErrorCode.UNAUTHORIZED ? 401 : 200);
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response status="failed" version="${version}" type="selftify" serverVersion="${config.serverVersion}" openSubsonic="true">\n${pad(`<error code="${code}" message="${message}"/>`)}\n</subsonic-response>`);
    return;
  }
  res.status(code === SubsonicErrorCode.UNAUTHORIZED ? 401 : 200);
  res.json({ "subsonic-response": envelope });
}

function pad(s: string): string {
  return "  " + s;
}
