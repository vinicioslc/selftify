import type { ImageCandidate, ImageSearchInput, ImageProvider } from "../../image-resolution/types";

export type { ImageCandidate as ArtworkCandidate, ImageSearchInput as ArtworkSearchInput, ImageProvider as ArtworkProvider } from "../../image-resolution/types";

export type ArtworkResult = {
  status: "resolved" | "no_providers" | "not_found" | "error";
  candidates: ImageCandidate[];
  winner?: string;
  elapsedMs: number;
};
