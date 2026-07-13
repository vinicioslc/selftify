import { getDb } from "../db/connection";

const PREFIX = "setting_";

export interface ServerSettings {
  libraryRoot?: string;
  listenBrainzToken?: string;
  scanStatus?: "idle" | "discovering" | "indexing" | "done" | "error";
  songCount?: number;
  artistCount?: number;
  albumCount?: number;
  // Online search configuration (dedicated route: /api/online-search)
  onlineSearchEnabled?: boolean;
  musicBrainzToken?: string;
  youtubeMusicHeaders?: string;
  downloadFolder?: string;
}

export function getSettings(): ServerSettings {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT key, value FROM config WHERE key LIKE ?")
      .all(`${PREFIX}%`) as { key: string; value: string }[];

    const settings: ServerSettings = {};
    for (const row of rows) {
      const settingKey = row.key.slice(PREFIX.length) as keyof ServerSettings;
      try {
        (settings as Record<string, unknown>)[settingKey] = JSON.parse(row.value);
      } catch {
        (settings as Record<string, unknown>)[settingKey] = row.value;
      }
    }
    return settings;
  } catch {
    return {};
  }
}

export function updateSettings(partial: Partial<ServerSettings>): ServerSettings {
  try {
    const db = getDb();
    const upsert = db.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );

    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(partial)) {
        upsert.run(`${PREFIX}${key}`, JSON.stringify(value));
      }
    });
    tx();
  } catch {
    // settings unavailable — return what we have
  }

  return getSettings();
}
