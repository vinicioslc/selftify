export async function preloadStream(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to preload stream: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export function revokeStream(blobUrl: string): void {
  URL.revokeObjectURL(blobUrl);
}
