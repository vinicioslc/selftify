/**
 * Test setup: provide fake IndexedDB so Dexie / local-database can be tested.
 * Must be imported before any module that imports Dexie.
 */
import { vi } from "vitest";

// Use fake-indexeddb to simulate IndexedDB in happy-dom
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { indexedDB, IDBCursor, IDBRequest, IDBTransaction, IDBKeyRange, IDBFactory } = require("fake-indexeddb");

globalThis.indexedDB = indexedDB;
globalThis.IDBCursor = IDBCursor;
globalThis.IDBRequest = IDBRequest;
globalThis.IDBTransaction = IDBTransaction;
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.IDBFactory = IDBFactory;
