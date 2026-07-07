import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { getPlatformService } from "../platform/factory";
import { CREATE_TABLES, SCHEMA_VERSION } from "./schema";
import { pruneExpiredRequestCache } from "./repositories/request-cache-repo";
import { joinPaths } from "../../lib/path-utils";

const SAVE_DEBOUNCE_MS = 5000;
const SAVE_INTERVAL_MS = 60000;

let db: SqlJsDatabase | null = null;
let dbPath = "";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave = false;
let initialized = false;

export type DbState = "closed" | "loading" | "ready" | "error";
let state: DbState = "closed";

export function getState(): DbState {
  return state;
}

export function isReady(): boolean {
  return state === "ready";
}

export function assertReady(): void {
  if (state !== "ready") throw new Error("Database not initialized");
}

function getDb(): SqlJsDatabase {
  assertReady();
  return db!;
}

export async function initDatabase(libraryRoot: string): Promise<void> {
  if (initialized) return;
  initialized = true;
  state = "loading";

  dbPath = joinPaths(libraryRoot, '.selftify/library.db');

  try {
    const p = await getPlatformService();
    const dir = joinPaths(libraryRoot, '.selftify');
    const dirExists = await p.fileExists(dir);
    if (!dirExists) await p.createDirectory(dir);

    const fileExists = await p.fileExists(dbPath);
    const SQL = await initSqlJs({
      locateFile: (file) => `./${file}`,
    });

    if (fileExists) {
      const raw = await p.readFile(dbPath);
      if (raw) {
        try {
          db = new SQL.Database(raw);
          db.exec("SELECT count(*) FROM _meta");
        } catch {
          console.warn("[db] corrupt, trying backup...");
          const bak = await p.readFile(dbPath + ".bak").catch(() => null);
          if (bak) {
            try {
              db = new SQL.Database(bak);
              db.exec("SELECT count(*) FROM _meta");
            } catch {
              db = null;
            }
          }
          if (!db) {
            console.warn("[db] creating fresh database");
            db = new SQL.Database();
          }
        }
      } else {
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    runMigrations();
    startPeriodicSave();
    state = "ready";
  } catch (err) {
    console.error("[db] init error:", err);
    state = "error";
    const SQL = await initSqlJs().catch(() => null);
    if (SQL) {
      db = new SQL.Database();
      runMigrations();
      startPeriodicSave();
    }
    state = "ready";
  }
}

function runMigrations(): void {
  for (const sql of CREATE_TABLES) {
    db!.exec(sql);
  }

  const existing = db!.exec("SELECT version FROM _meta LIMIT 1");
  const currentVersion = existing.length > 0 ? (existing[0].values[0][0] as number) : 0;

  // Ensure deleted_at column exists — old databases created before this column
  // was added to the CREATE TABLE statement may lack it.
  try {
    db!.exec("ALTER TABLE albums ADD COLUMN deleted_at INTEGER");
  } catch {
    // column may already exist — ignore
  }

  // Ensure bitrate column exists on tracks — added in schema v5
  try {
    db!.exec("ALTER TABLE tracks ADD COLUMN bitrate INTEGER");
  } catch {
    // column may already exist — ignore
  }

  if (currentVersion < SCHEMA_VERSION) {
    db!.exec(`UPDATE _meta SET version = ${SCHEMA_VERSION}`);
  }
}

function startPeriodicSave(): void {
  setInterval(() => {
    if (db) scheduleSave();
  }, SAVE_INTERVAL_MS);

  // Prune expired request cache entries every 5 minutes
  setInterval(() => {
    try {
      pruneExpiredRequestCache();
    } catch {
      // silently ignore
    }
  }, 5 * 60 * 1000);
}

function scheduleSave(): void {
  if (pendingSave) return;
  pendingSave = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
}

async function doSave(): Promise<void> {
  saveTimer = null;
  pendingSave = false;
  try {
    const data = db!.export();
    const p = await getPlatformService();
    const bakPath = dbPath + ".bak";
    const exists = await p.fileExists(dbPath);
    if (exists) {
      await p.renameFile(dbPath, bakPath).catch(() => {});
    }
    await p.writeFile(dbPath, data);
  } catch (err) {
    console.warn("[db] save error:", err);
  }
}

export async function flushSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (pendingSave || db) {
    pendingSave = false;
    await doSave();
  }
}

export function exportDb(): Uint8Array {
  return getDb().export();
}

export function query<T = Record<string, unknown>>(sql: string, params?: any[]): T[] {
  const d = getDb();
  const stmt = d.prepare(sql);
  if (params) stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return rows;
}

export function exec(sql: string, params?: any[]): void {
  const d = getDb();
  if (params) {
    const stmt = d.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
  } else {
    d.exec(sql);
  }
  scheduleSave();
}

export function execMany(sql: string, allParams: any[][]): void {
  const d = getDb();
  const stmt = d.prepare(sql);
  for (const params of allParams) {
    stmt.bind(params);
    stmt.step();
    stmt.reset();
  }
  stmt.free();
}

export function beginTransaction(): void {
  getDb().exec("BEGIN TRANSACTION");
}

export function commitTransaction(): void {
  getDb().exec("COMMIT");
}
