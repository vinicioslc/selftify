import { useState, useEffect } from "react";

export type ArtistImageSource = "backend" | null;

export function useArtistImage(_mbid: string | undefined, _name: string, imageUrl?: string | null) {
  const [imageUrlState, setImageUrl] = useState<string | null>(imageUrl ?? null);
  const [source, setSource] = useState<ArtistImageSource>(imageUrl ? "backend" : null);

  useEffect(() => {
    setImageUrl(imageUrl ?? null);
    setSource(imageUrl ? "backend" : null);
  }, [imageUrl]);

  return { imageUrl: imageUrlState, source };
}

export function useLazyArtistImage(_mbid: string | undefined, _name: string, imageUrl?: string | null) {
  const [imageUrlState, setImageUrl] = useState<string | null>(imageUrl ?? null);
  const [source, setSource] = useState<ArtistImageSource>(imageUrl ? "backend" : null);

  useEffect(() => {
    setImageUrl(imageUrl ?? null);
    setSource(imageUrl ? "backend" : null);
  }, [imageUrl]);

  return { imageUrl: imageUrlState, source };
}
