import { getDb } from "../db/connection";

const PREFIX = "setting_";

export function getSettings(): Record<string, any> {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT key, value FROM config WHERE key LIKE ?")
      .all(`${PREFIX}%`) as { key: string; value: string }[];

    const settings: Record<string, any> = {};
    for (const row of rows) {
      const settingKey = row.key.slice(PREFIX.length);
      try {
        settings[settingKey] = JSON.parse(row.value);
      } catch {
        settings[settingKey] = row.value;
      }
    }
    return settings;
  } catch {
    return {};
  }
}

export function updateSettings(partial: Record<string, any>): Record<string, any> {
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
