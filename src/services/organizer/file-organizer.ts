import { getPlatformService } from "../platform/factory";
import { cachedRead, cachedReadDirectory, cachedWrite, cachedDelete, cachedExists, cachedCreateDirectory, cachedRename } from "../sqlite-db/sqlite-db-cache";
import { sanitizeForPath } from "./sanitizer";
import { joinPaths } from "../../lib/path-utils";
import type { DirEntry } from "../platform/types";
import { findBestCover, writeCoverToAlbumDir } from "./cover-utils";

export interface OrganizeContext {
  libraryRoot: string;
  sourcePath: string;
  artistName: string;
  albumName: string | null;
  releaseYear: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  trackTitle: string;
  extension: string;
}

export interface OrganizeResult {
  sourcePath: string;
  targetPath: string | null;
  targetAlbumRelDir: string;
  targetFileName: string;
  movedSidecars: string[];
  createdFiles: string[];
  skipped: boolean;
  error?: string;
}

export interface TargetPaths {
  artistDir: string;
  albumDir: string;
  targetFileName: string;
  targetAlbumRelDir: string;
  targetPath: string;
}

export interface FileOrganizer {
  buildTargetPath(ctx: OrganizeContext): TargetPaths;
  organizeFile(ctx: OrganizeContext): Promise<OrganizeResult>;
  writeAlbumArtifacts(targetAlbumDir: string, ctx: {
    libraryRoot: string;
    albumName: string;
    artistName: string;
    releaseYear: number | null;
    genres: string[];
    tracks: {
      title: string;
      trackNumber: number | null;
      duration: number | null;
      mbzRecordingId?: string | null;
      mbzTrackId?: string | null;
      discNumber?: number | null;
      artistName?: string | null;
    }[];
    coverRelPath: string | null;
    mbzId?: string | null;
    mbzReleaseGroupId?: string | null;
    albumArtist?: string | null;
    albumArtistMbid?: string | null;
    type?: string | null;
  }): Promise<string[]>;
  writeArtistArtifacts(targetArtistDir: string, ctx: {
    artistName: string;
    genres: string[];
    mbid: string | null;
    sortName?: string | null;
    type?: string | null;
    disambiguation?: string | null;
    thumb?: string | null;
  }): Promise<string[]>;
}

function padTrackNumber(trackNumber: number | null, discNumber: number | null): string {
  if (discNumber && discNumber > 1) {
    return `${String(discNumber).padStart(2, "0")}-${String(trackNumber || 0).padStart(2, "0")}`;
  }
  if (trackNumber != null) {
    return String(trackNumber).padStart(2, "0");
  }
  return "";
}

export function createFileOrganizer(libraryRoot: string): FileOrganizer {
  function buildTargetPath(ctx: OrganizeContext): TargetPaths {
    const artistDir = sanitizeForPath(ctx.artistName);
    const albumName = ctx.albumName || "Unknown Album";
    const albumDirBase = sanitizeForPath(albumName);
    const albumDir = ctx.releaseYear
      ? `${albumDirBase} (${ctx.releaseYear})`
      : albumDirBase;

    const paddedTrack = padTrackNumber(ctx.trackNumber, ctx.discNumber);
    const parts = [
      ctx.artistName ? sanitizeForPath(ctx.artistName) : "",
      ctx.albumName ? sanitizeForPath(ctx.albumName) : "",
      paddedTrack,
      ctx.trackTitle ? sanitizeForPath(ctx.trackTitle) : "",
    ].filter(Boolean);
    const targetFileName = `${parts.join(" - ")}${ctx.extension}`;

    const targetAlbumRelDir = joinPaths(artistDir, albumDir);
    const targetPath = joinPaths(libraryRoot, targetAlbumRelDir, targetFileName);

    return { artistDir, albumDir, targetFileName, targetAlbumRelDir, targetPath };
  }

  async function moveFile(sourcePath: string, targetPath: string): Promise<boolean> {
    try {
      await cachedCreateDirectory(
        targetPath.substring(0, targetPath.lastIndexOf("/")),
      );

      const p = await getPlatformService();
      const ok = await p.renameFile(sourcePath, targetPath);
      if (ok) return true;

      const data = await cachedRead(sourcePath);
      if (!data) return false;

      await cachedWrite(targetPath, data);
      await cachedDelete(sourcePath);
      return true;
    } catch (err) {
      console.warn("[organizer] moveFile failed:", err);
      return false;
    }
  }

  async function discoverSidecars(sourcePath: string): Promise<string[]> {
    const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf("/"));
    let entries: DirEntry[];
    try {
      entries = await cachedReadDirectory(sourceDir);
    } catch {
      return [];
    }
    const sourceName = sourcePath.split("/").pop() || "";
    const baseName = sourceName.replace(/\.[^/.]+$/, "");
    const sidecars: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile) continue;
      if (entry.name === `${baseName}.lrc`) {
        sidecars.push(entry.path);
      }
    }
    return sidecars;
  }

  async function organizeFile(ctx: OrganizeContext): Promise<OrganizeResult> {
    try {
      const paths = buildTargetPath(ctx);

      const movedSidecars: string[] = [];
      const createdFiles: string[] = [];

      if (paths.targetPath === ctx.sourcePath) {
        return {
          sourcePath: ctx.sourcePath,
          targetPath: paths.targetPath,
          targetAlbumRelDir: paths.targetAlbumRelDir,
          targetFileName: paths.targetFileName,
          movedSidecars,
          createdFiles,
          skipped: true,
        };
      }

      const targetExists = await cachedExists(paths.targetPath);
      if (targetExists) {
        console.warn(`[organizer] target already exists, skipping: ${paths.targetPath}`);
        return {
          sourcePath: ctx.sourcePath,
          targetPath: null,
          targetAlbumRelDir: paths.targetAlbumRelDir,
          targetFileName: paths.targetFileName,
          movedSidecars,
          createdFiles,
          skipped: true,
        };
      }

      const moved = await moveFile(ctx.sourcePath, paths.targetPath);
      if (!moved) {
        return {
          sourcePath: ctx.sourcePath,
          targetPath: null,
          targetAlbumRelDir: paths.targetAlbumRelDir,
          targetFileName: paths.targetFileName,
          movedSidecars,
          createdFiles,
          skipped: false,
          error: "Failed to move file",
        };
      }

      const sidecars = await discoverSidecars(ctx.sourcePath);
      const targetDir = paths.targetPath.substring(0, paths.targetPath.lastIndexOf("/"));
      for (const sidecar of sidecars) {
        const sidecarName = sidecar.split("/").pop() || "";
        const targetSidecarPath = joinPaths(targetDir, sidecarName);
        const ok = await moveFile(sidecar, targetSidecarPath);
        if (ok) {
          movedSidecars.push(sidecar);
        }
      }

      return {
        sourcePath: ctx.sourcePath,
        targetPath: paths.targetPath,
        targetAlbumRelDir: paths.targetAlbumRelDir,
        targetFileName: paths.targetFileName,
        movedSidecars,
        createdFiles,
        skipped: false,
      };
    } catch (err: any) {
      return {
        sourcePath: ctx.sourcePath,
        targetPath: null,
        targetAlbumRelDir: "",
        targetFileName: "",
        movedSidecars: [],
        createdFiles: [],
        skipped: false,
        error: err?.message || String(err),
      };
    }
  }

  async function writeAlbumArtifacts(
    targetAlbumDir: string,
    params: {
      libraryRoot: string;
      albumName: string;
      artistName: string;
      releaseYear: number | null;
      genres: string[];
      tracks: {
        title: string;
        trackNumber: number | null;
        duration: number | null;
        mbzRecordingId?: string | null;
        mbzTrackId?: string | null;
        discNumber?: number | null;
        artistName?: string | null;
      }[];
      coverRelPath: string | null;
      mbzId?: string | null;
      mbzReleaseGroupId?: string | null;
      albumArtist?: string | null;
      albumArtistMbid?: string | null;
      type?: string | null;
    },
  ): Promise<string[]> {
    const created: string[] = [];

    const coverSource = await findBestCover(params.libraryRoot, targetAlbumDir, params.coverRelPath);
    if (coverSource) {
      const wrote = await writeCoverToAlbumDir(targetAlbumDir, coverSource);
      if (wrote) created.push(joinPaths(targetAlbumDir, "cover.jpg"));
    }

    const nfoPath = joinPaths(targetAlbumDir, "album.nfo");
    const nfoExists = await cachedExists(nfoPath);
    if (!nfoExists) {
      const { generateAlbumNfoXml } = await import("./nfo-generator");
      const xml = generateAlbumNfoXml({
        title: params.albumName,
        artist: params.artistName,
        year: params.releaseYear,
        genres: params.genres,
        mbzAlbumId: params.mbzId,
        mbzReleaseGroupId: params.mbzReleaseGroupId,
        albumArtist: params.albumArtist,
        albumArtistMbid: params.albumArtistMbid,
        type: params.type,
        duration: params.tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
        thumb: coverSource ? "cover.jpg" : null,
        tracks: params.tracks.map((t) => ({
          title: t.title,
          trackNumber: t.trackNumber,
          duration: t.duration,
          mbzRecordingId: t.mbzRecordingId,
          mbzTrackId: t.mbzTrackId,
          discNumber: t.discNumber,
          artistName: t.artistName,
        })),
      });
      await cachedCreateDirectory(targetAlbumDir);
      await cachedWrite(nfoPath, new TextEncoder().encode(xml));
      created.push(nfoPath);
    }

    return created;
  }

  async function writeArtistArtifacts(
    targetArtistDir: string,
    params: {
      artistName: string;
      genres: string[];
      mbid: string | null;
      sortName?: string | null;
      type?: string | null;
      disambiguation?: string | null;
      thumb?: string | null;
    },
  ): Promise<string[]> {
    const created: string[] = [];

    const nfoPath = joinPaths(targetArtistDir, "artist.nfo");
    const nfoExists = await cachedExists(nfoPath);
    if (!nfoExists) {
      const { generateArtistNfoXml } = await import("./nfo-generator");
      const xml = generateArtistNfoXml({
        name: params.artistName,
        genres: params.genres,
        mbid: params.mbid,
        sortName: params.sortName,
        type: params.type,
        disambiguation: params.disambiguation,
        thumb: params.thumb,
      });
      await cachedCreateDirectory(targetArtistDir);
      await cachedWrite(nfoPath, new TextEncoder().encode(xml));
      created.push(nfoPath);
    }

    return created;
  }

  return { buildTargetPath, organizeFile, writeAlbumArtifacts, writeArtistArtifacts };
}
