import type { SqliteDbMbzYtMapping, CandidateData } from "./sqlite-db-types";
import { useAuthStore } from "../../stores/auth.store";
import { OriginType } from "../../types/domain-types";
import { initDatabase, isReady } from "../db/database";
import * as mappingRepo from "../db/repositories/mapping-repo";

async function ensureDb(): Promise<boolean> {
  if (isReady()) return true;
  const root = getLibraryRoot();
  if (!root) return false;
  try {
    await initDatabase(root);
    return isReady();
  } catch {
    return false;
  }
}

function getLibraryRoot(): string | undefined {
  return useAuthStore.getState().origins.find((o) => o.type === OriginType.LOCAL)?.folderPath;
}

export async function getMbzYtMapping(
  _libraryRoot: string,
  mbzRecordingId: string,
): Promise<SqliteDbMbzYtMapping | null> {
  const ready = await ensureDb();
  if (!ready) return null;
  return mappingRepo.getMapping(mbzRecordingId);
}

export async function setMbzYtMapping(
  _libraryRoot: string,
  mapping: SqliteDbMbzYtMapping,
): Promise<void> {
  const ready = await ensureDb();
  if (!ready) return;
  mappingRepo.upsertMapping(mapping);
}

export async function deleteMbzYtMapping(
  _libraryRoot: string,
  mbzRecordingId: string,
): Promise<void> {
  const ready = await ensureDb();
  if (!ready) return;
  mappingRepo.deleteMapping(mbzRecordingId);
}

export async function getAllMbzYtMappings(
  _libraryRoot: string,
): Promise<SqliteDbMbzYtMapping[]> {
  const ready = await ensureDb();
  if (!ready) return [];
  return mappingRepo.getAllMappings();
}

export async function deleteMbzYtMappingByMbzId(
  libraryRoot: string,
  mbzRecordingId: string,
): Promise<void> {
  await deleteMbzYtMapping(libraryRoot, mbzRecordingId);
}

export async function clearAllMbzYtMappings(_libraryRoot: string): Promise<void> {
  const ready = await ensureDb();
  if (!ready) return;
  mappingRepo.clearAllMappings();
}

export async function getSavedMbzYtMapping(mbzRecordingId: string): Promise<SqliteDbMbzYtMapping | null> {
  const root = getLibraryRoot();
  if (!root) return null;
  return getMbzYtMapping(root, mbzRecordingId);
}

export async function setSavedMbzYtMapping(mapping: SqliteDbMbzYtMapping): Promise<void> {
  const root = getLibraryRoot();
  if (!root) return;
  return setMbzYtMapping(root, mapping);
}

export async function deleteSavedMbzYtMapping(mbzRecordingId: string): Promise<void> {
  const root = getLibraryRoot();
  if (!root) return;
  return deleteMbzYtMapping(root, mbzRecordingId);
}

export async function getAllSavedMbzYtMappings(): Promise<SqliteDbMbzYtMapping[]> {
  const root = getLibraryRoot();
  if (!root) return [];
  return getAllMbzYtMappings(root);
}

export async function clearAllSavedMbzYtMappings(): Promise<void> {
  const root = getLibraryRoot();
  if (!root) return;
  return clearAllMbzYtMappings(root);
}

export type { SqliteDbMbzYtMapping as MbzYtMapping, CandidateData } from "./sqlite-db-types";
