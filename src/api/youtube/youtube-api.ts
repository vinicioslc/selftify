import { Innertube } from "youtubei.js";
import type { ApiContext } from "../controller";

let currentInstance: Innertube | null = null;
let currentCookie: string | null = null;

export async function getYouTubeClient(ctx: ApiContext): Promise<Innertube> {
  const cookieStr = ctx.credential || "";
  if (currentInstance && currentCookie === cookieStr) {
    return currentInstance;
  }
  const instance = await Innertube.create({
    cookie: cookieStr,
    retrieve_player: false,
    client_type: "YT_MUSIC" as any,
    fetch: (input: any, init?: any) => globalThis.fetch(input, init),
  });
  currentInstance = instance;
  currentCookie = cookieStr;
  return instance;
}

export function clearClient(): void {
  currentInstance = null;
  currentCookie = null;
}

export function parseCookies(cookiesText: string): string {
  const cookies: string[] = [];
  const lines = cookiesText.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const parts = trimmed.split("\t");
    if (parts.length >= 7) {
      const name = parts[5]?.trim();
      const value = parts[6]?.trim();
      if (name && value) cookies.push(`${name}=${value}`);
    } else {
      const pairs = trimmed.includes("\t") ? trimmed.split("\t") : trimmed.split("; ");
      for (const pair of pairs) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx > 0) {
          const name = pair.substring(0, eqIdx).trim();
          const value = pair.substring(eqIdx + 1).trim();
          if (name && value) cookies.push(`${name}=${value}`);
        }
      }
    }
  }
  return cookies.join("; ");
}

export async function authenticateWithCookies(cookiesText: string): Promise<{ cookie: string; username: string }> {
  const cookieStr = parseCookies(cookiesText);
  const yt = await Innertube.create({
    cookie: cookieStr,
    retrieve_player: false,
    client_type: "YT_MUSIC" as any,
    fetch: (input: any, init?: any) => globalThis.fetch(input, init),
  });
  const isLoggedIn = yt.session.logged_in;
  if (!isLoggedIn) throw new Error("Invalid cookies: could not authenticate with YouTube Music");
  currentInstance = yt;
  currentCookie = cookieStr;
  let username = "YouTube Music User";
  try {
    const channel = await yt.getChannel((yt.session as any).channel_id || "");
    if ((channel as any)?.header?.title) {
      username = (channel as any).header.title;
    }
  } catch {}
  return { cookie: cookieStr, username };
}
