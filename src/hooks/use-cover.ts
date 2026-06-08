import { useState, useEffect, useRef, useCallback } from "react";
import { coverEventBus, makeCoverKey } from "../services/cover-event-bus";
import { resolveAlbumCover, type CoverInput } from "../services/cover-resolver";

export type { CoverInput };

const blobCache = new Map<string, string>();

function releaseBlobUrl(url: string | null | undefined) {
  if (url && url.startsWith("blob:")) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}

export function useCover(input: CoverInput) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const prevKeyRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const inputRef = useRef(input);
  inputRef.current = input;

  const resolve = useCallback(async () => {
    try {
      const { artistName, albumName, mbzArtistId, mbzReleaseGroupId, mbzReleaseId } = inputRef.current;
      const key1 = makeCoverKey(artistName || null, albumName || null);
      const key2 = makeCoverKey(mbzArtistId || null, mbzReleaseGroupId || null);
      const key3 = makeCoverKey(mbzArtistId || null, mbzReleaseId || null);
      const activeKey = key2 || key3 || key1;

      if (!activeKey) {
        if (mountedRef.current) {
          setCoverUrl(null);
          setLoading(false);
        }
        return;
      }

      const cached = blobCache.get(activeKey);
      if (cached) {
        if (mountedRef.current) {
          setCoverUrl(cached);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const result = await resolveAlbumCover(inputRef.current);
      const blobUrl = result.blobUrl;

      if (!mountedRef.current) {
        if (blobUrl) releaseBlobUrl(blobUrl);
        return;
      }

      if (blobUrl) {
        blobCache.set(activeKey, blobUrl);
        setCoverUrl(blobUrl);
      } else {
        setCoverUrl(null);
      }
    } catch (err) {
      console.warn("[useCover] resolve error:", err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const { artistName, albumName, mbzArtistId, mbzReleaseGroupId, mbzReleaseId } = input;
    const key1 = makeCoverKey(artistName || null, albumName || null);
    const key2 = makeCoverKey(mbzArtistId || null, mbzReleaseGroupId || null);
    const key3 = makeCoverKey(mbzArtistId || null, mbzReleaseId || null);
    const activeKey = key2 || key3 || key1;

    if (prevKeyRef.current && prevKeyRef.current !== activeKey) {
      const old = blobCache.get(prevKeyRef.current);
      if (old) {
        blobCache.delete(prevKeyRef.current);
        releaseBlobUrl(old);
      }
    }

    prevKeyRef.current = activeKey;

    resolve();

    const keys = [key1, key2, key3].filter(Boolean) as string[];
    const unsubFns = keys.map((k) => {
      const parts = k.split("|");
      return coverEventBus.subscribe(parts[0], parts[1], () => {
        if (mountedRef.current) {
          resolve();
        }
      });
    });

    unsubRef.current = () => unsubFns.forEach((fn) => fn());

    return () => {
      mountedRef.current = false;
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [
    input.artistName,
    input.albumName,
    input.mbzArtistId,
    input.mbzReleaseGroupId,
    input.mbzReleaseId,
    resolve,
  ]);

  return { coverUrl, loading };
}

export function getCoverKeyFromSong(song: {
  artistName?: string;
  albumName?: string;
  mbzArtistId?: string;
}) {
  const mbzKey = makeCoverKey(song.mbzArtistId, song.mbzArtistId ? "__rg__" : null);
  return mbzKey || makeCoverKey(song.artistName, song.albumName);
}

export function getCoverKeyFromAlbum(album: {
  albumArtistName?: string;
  name?: string;
  mbzReleaseGroupId?: string;
}) {
  const mbzKey = makeCoverKey(album.albumArtistName, album.mbzReleaseGroupId);
  return mbzKey || makeCoverKey(album.albumArtistName, album.name);
}
