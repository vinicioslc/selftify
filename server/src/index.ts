import { createApp } from "./app";
import { config } from "./config";
import { initDb, closeDb, isDbReady } from "./db/connection";
import { getSettings } from "./services/settings";

try {
  initDb();

  // Restore persisted library root if one was saved
  try {
    const persisted = getSettings();
    if (persisted.libraryRoot && typeof persisted.libraryRoot === "string") {
      config.libraryRoot = persisted.libraryRoot;
    }
  } catch {
    // settings unavailable — use env default
  }
} catch (err) {
  console.warn("[Selftify] Database init failed; server continues without library data:", (err as Error).message);
}

const app = createApp();
const PORT = config.port;

const server = app.listen(PORT, () => {
  console.log(`[Selftify] Server running on http://localhost:${PORT}`);
  console.log(`[Selftify] Library root: ${config.libraryRoot}`);
  console.log(`[Selftify] Database ready: ${isDbReady()}`);
  console.log(`[Selftify] Subsonic API: http://localhost:${PORT}/rest`);
});

function shutdown(): void {
  console.log("\n[Selftify] Shutting down...");
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
