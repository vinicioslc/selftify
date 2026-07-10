import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { SubsonicError, SubsonicErrorCode } from "./errors";
import { sendError } from "./response";

export interface SubsonicRequest extends Request {
  subsonic?: {
    user: string;
    client: string;
    version: string;
    format: "json" | "xml";
  };
}

function md5(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

function authenticate(user: string, salt: string, token: string, password: string): boolean {
  if (!salt || !token) return false;
  return md5(password + salt) === token.toLowerCase();
}

function authenticatePlain(user: string, password: string, supplied: string): boolean {
  // Subsonic `p` may be hex-encoded ("enc:" prefix) or plaintext.
  if (supplied.startsWith("enc:")) {
    try {
      const decoded = Buffer.from(supplied.slice(4), "hex").toString("utf-8");
      return decoded === password;
    } catch {
      return false;
    }
  }
  return supplied === password;
}

export function subsonicAuth(req: SubsonicRequest, res: Response, next: NextFunction): void {
  const query = req.method === "GET" ? req.query : { ...req.query, ...req.body };
  const user = String(query.u || "");
  const token = String(query.t || "");
  const salt = String(query.s || "");
  const passwordParam = String(query.p || "");
  const version = String(query.v || config.apiVersion);
  const client = String(query.c || "selftify-web");
  const format = String(query.f || "json").toLowerCase() === "xml" ? "xml" : "json";

  res.locals.format = format;
  res.locals.version = version;

  try {
    if (!user) throw new SubsonicError(SubsonicErrorCode.NOT_AUTHENTICATED, "User required.");
    if (user !== config.subsonicUser) {
      throw new SubsonicError(SubsonicErrorCode.UNAUTHORIZED, "Invalid username or password.");
    }

    let ok = false;
    if (passwordParam) {
      ok = authenticatePlain(user, config.subsonicPassword, passwordParam);
    } else if (token && salt) {
      ok = authenticate(user, salt, token, config.subsonicPassword);
    } else {
      throw new SubsonicError(SubsonicErrorCode.NOT_AUTHENTICATED, "Authentication required (token or password).");
    }

    if (!ok) throw new SubsonicError(SubsonicErrorCode.UNAUTHORIZED, "Invalid username or password.");

    req.subsonic = { user, client, version, format };
    next();
  } catch (err) {
    sendError(res, err, version);
  }
}
