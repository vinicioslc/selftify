import { useState, useEffect } from "react";

export type CoverInput = {
  artistName?: string | null;
  albumName?: string | null;
  mbzArtistId?: string | null;
  mbzReleaseGroupId?: string | null;
  mbzReleaseId?: string | null;
  imageUrl?: string | null;
};

export function useCover(input: CoverInput) {
  const [coverUrl, setCoverUrl] = useState<string | null>(input.imageUrl ?? null);
  const [source, setSource] = useState<string | null>(input.imageUrl ? "backend" : null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCoverUrl(input.imageUrl ?? null);
    setSource(input.imageUrl ? "backend" : null);
    setLoading(false);
  }, [input.imageUrl]);

  return { coverUrl, source, loading };
}

export function clearCoverCache() {
  // No-op — frontend não resolve mais covers
}
