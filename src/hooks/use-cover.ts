import { useState, useEffect, useRef, useCallback } from "react";
import { coverEventBus, makeCoverKey } from "../services/cover-event-bus";
import { resolveAlbumCoverLocalOnly, type CoverInput, type CoverSource } from "../services/cover-resolver";

export type { CoverInput };

const blobCache = new Map<string, string>();
const sourceCache = new Map<string, CoverSource>();

function releaseBlobUrl(url: string | null | undefined) {
  if (url && url.startsWith("blob:")) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}

function getActiveKey(input: CoverInput): string | null {
  const key1 = makeCoverKey(input.artistName || null, input.albumName || null);
  const key2 = makeCoverKey(input.mbzArtistId || null, input.mbzReleaseGroupId || null);
  const key3 = makeCoverKey(input.mbzArtistId || null, input.mbzReleaseId || null);
  return key2 || key3 || key1;
}

export function useCover(input: CoverInput) {
  const hasImageUrl = !!input.imageUrl;
  const [coverUrl, setCoverUrl] = useState<string | null>(input.imageUrl ?? null);
  const [source, setSource] = useState<CoverSource | null>(hasImageUrl ? "backend" : null);
  const [loading, setLoading] = useState(!hasImageUrl);
  const prevKeyRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const inputRef = useRef(input);
  inputRef.current = input;

  const resolve = useCallback(async () => {
    if (inputRef.current.imageUrl) {
      if (mountedRef.current) {
        setCoverUrl(inputRef.current.imageUrl);
        setSource("backend");
        setLoading(false);
      }
      return;
    }

    const activeKey = getActiveKey(inputRef.current);
    if (!activeKey) {
      if (mountedRef.current) { setCoverUrl(null); setSource(null); setLoading(false); }
      return;
    }
    const cached = blobCache.get(activeKey);
    if (cached) {
      if (mountedRef.current) { setCoverUrl(cached); setLoading(false); }
      return;
    }
    setLoading(true);
    const result = await resolveAlbumCoverLocalOnly(inputRef.current);
    if (!mountedRef.current) { if (result.blobUrl) releaseBlobUrl(result.blobUrl); return; }
    if (result.blobUrl) {
      blobCache.set(activeKey, result.blobUrl);
      sourceCache.set(activeKey, result.source);
      setCoverUrl(result.blobUrl);
      setSource(result.source);
    } else {
      setCoverUrl(null);
      setSource(null);
    }
    if (mountedRef.current) setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const activeKey = getActiveKey(input);

    if (prevKeyRef.current && prevKeyRef.current !== activeKey) {
      const old = blobCache.get(prevKeyRef.current);
      if (old) {
        blobCache.delete(prevKeyRef.current);
        sourceCache.delete(prevKeyRef.current);
        releaseBlobUrl(old);
      }
    }

    prevKeyRef.current = activeKey;
    const cachedSource = activeKey ? sourceCache.get(activeKey) : undefined;
    if (cachedSource) setSource(cachedSource);

    resolve();

    const keys = [
      makeCoverKey(input.artistName || null, input.albumName || null),
      makeCoverKey(input.mbzArtistId || null, input.mbzReleaseGroupId || null),
      makeCoverKey(input.mbzArtistId || null, input.mbzReleaseId || null),
    ].filter(Boolean) as string[];

    const unsubFns = keys.map((k) => {
      const parts = k.split("|");
      return coverEventBus.subscribe(parts[0], parts[1], () => {
        if (mountedRef.current) resolve();
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

  return { coverUrl, source, loading };
}

export function clearCoverCache(
  artistName?: string | null,
  albumName?: string | null,
  mbzArtistId?: string | null,
  mbzReleaseGroupId?: string | null,
  mbzReleaseId?: string | null,
): void {
  const keys = [
    makeCoverKey(artistName, albumName),
    makeCoverKey(mbzArtistId, mbzReleaseGroupId),
    makeCoverKey(mbzArtistId, mbzReleaseId),
  ];
  for (const key of keys) {
    if (key && blobCache.has(key)) {
      releaseBlobUrl(blobCache.get(key));
      blobCache.delete(key);
    }
  }
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
  mbzArtistId?: string;
  mbzReleaseGroupId?: string;
}) {
  const mbzKey = makeCoverKey(album.mbzArtistId, album.mbzReleaseGroupId);
  return mbzKey || makeCoverKey(album.albumArtistName, album.name);
}
