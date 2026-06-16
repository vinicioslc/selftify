import { md5Hash, storeImage } from "./image-store";
import type { ImageRecord } from "./image-store";
import type { PlatformService } from "./platform/types";

export async function importFromDotImg(
  dirPath: string,
  p: PlatformService,
  extraRecord: Partial<ImageRecord> = {},
): Promise<string | null> {
  const entries = await p.readDirectory(dirPath).catch(() => []);
  const imageFile = entries.find((e) => e.isFile && /\.(jpg|jpeg|png|webp)$/i.test(e.name));
  if (!imageFile) return null;
  const raw = await p.readFile(imageFile.path);
  if (!raw) return null;
  const blob = new Blob([raw] as BlobPart[]);
  const arrayBuffer = await blob.arrayBuffer();
  const ext = imageFile.name.endsWith(".png") ? "image/png" : imageFile.name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  const hash = await md5Hash(arrayBuffer);
  const record: ImageRecord = { md5: hash, blob: arrayBuffer, format: ext, size: arrayBuffer.byteLength, createdAt: Date.now(), sourceUrl: imageFile.path, ...extraRecord };
  await storeImage(record);
  return URL.createObjectURL(blob);
}

export async function clearDotImgDir(dirPath: string, p: PlatformService): Promise<void> {
  const entries = await p.readDirectory(dirPath).catch(() => []);
  for (const e of entries) {
    if (e.isFile) await p.deleteFile(e.path).catch(() => {});
  }
}
