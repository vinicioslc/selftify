import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCachedWrite = vi.fn();
const mockCachedExists = vi.fn();
const mockCachedRead = vi.fn();
const mockCachedCreateDirectory = vi.fn();

vi.mock("../sqlite-db-cache", () => ({
  cachedRead: (...args: unknown[]) => mockCachedRead(...args),
  cachedWrite: (...args: unknown[]) => mockCachedWrite(...args),
  cachedExists: (...args: unknown[]) => mockCachedExists(...args),
  cachedCreateDirectory: (...args: unknown[]) => mockCachedCreateDirectory(...args),
}));

import { saveSqliteDbImage, readSqliteDbImage, imageCategoryRelativeDir, sha256Hash } from "../sqlite-db-image";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("imageCategoryRelativeDir", () => {
  it("retorna path relativo para artista", () => {
    expect(imageCategoryRelativeDir("artist")).toBe(".selftify/images/artist");
  });

  it("retorna path relativo para album", () => {
    expect(imageCategoryRelativeDir("album")).toBe(".selftify/images/album");
  });

  it("retorna path relativo para query", () => {
    expect(imageCategoryRelativeDir("query")).toBe(".selftify/images/query");
  });
});

describe("saveSqliteDbImage", () => {
  const ROOT = "/home/user/Music";
  const HASH = "abc123def456";
  const DATA = new Uint8Array([1, 2, 3, 4]);

  it("salva imagem de album com path sem duplicacao", async () => {
    mockCachedExists.mockResolvedValue(false);

    const relPath = await saveSqliteDbImage(ROOT, "album", HASH, DATA, "image/jpeg");

    expect(relPath).toBe(`.selftify/images/album/${HASH}.jpg`);
    expect(mockCachedWrite).toHaveBeenCalledWith(
      `${ROOT}/.selftify/images/album/${HASH}.jpg`,
      DATA,
    );
  });

  it("salva imagem de artista com path sem duplicacao", async () => {
    mockCachedExists.mockResolvedValue(false);

    const relPath = await saveSqliteDbImage(ROOT, "artist", HASH, DATA, "image/png");

    expect(relPath).toBe(`.selftify/images/artist/${HASH}.png`);
    expect(mockCachedCreateDirectory).toHaveBeenCalledWith(
      `${ROOT}/.selftify/images/artist`,
    );
  });

  it("salva imagem de query com path sem duplicacao", async () => {
    mockCachedExists.mockResolvedValue(false);

    const relPath = await saveSqliteDbImage(ROOT, "query", HASH, DATA, "image/webp");

    expect(relPath).toBe(`.selftify/images/query/${HASH}.webp`);
  });

  it("nao sobrescreve imagem existente", async () => {
    mockCachedExists.mockResolvedValue(true);

    const relPath = await saveSqliteDbImage(ROOT, "album", HASH, DATA, "image/jpeg");

    expect(relPath).toBe(`.selftify/images/album/${HASH}.jpg`);
    expect(mockCachedWrite).not.toHaveBeenCalled();
  });

  it("usa extensao jpg para formatos desconhecidos", async () => {
    mockCachedExists.mockResolvedValue(false);

    const relPath = await saveSqliteDbImage(ROOT, "album", HASH, DATA, "image/bmp");

    expect(relPath).toBe(`.selftify/images/album/${HASH}.jpg`);
  });

  it("cria diretorio de categoria se nao existir", async () => {
    mockCachedExists.mockResolvedValue(false);

    await saveSqliteDbImage(ROOT, "album", HASH, DATA, "image/jpeg");

    expect(mockCachedCreateDirectory).toHaveBeenCalledWith(
      `${ROOT}/.selftify/images/album`,
    );
  });

  it("nao recria diretorio se ja existir", async () => {
    mockCachedExists.mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await saveSqliteDbImage(ROOT, "album", HASH, DATA, "image/jpeg");

    expect(mockCachedCreateDirectory).not.toHaveBeenCalled();
  });
});

describe("readSqliteDbImage", () => {
  const ROOT = "/home/user/Music";

  it("le imagem pelo path relativo", async () => {
    const data = new Uint8Array([1, 2, 3]);
    mockCachedRead.mockResolvedValue(data);

    const result = await readSqliteDbImage(ROOT, ".selftify/images/album/hash.jpg");

    expect(mockCachedRead).toHaveBeenCalledWith(
      `${ROOT}/.selftify/images/album/hash.jpg`,
    );
    expect(result).toBe(data);
  });

  it("retorna null se arquivo nao existe", async () => {
    mockCachedRead.mockResolvedValue(null);

    const result = await readSqliteDbImage(ROOT, ".selftify/images/album/hash.jpg");

    expect(result).toBeNull();
  });
});

describe("sha256Hash", () => {
  it("retorna hash hexadecimal", async () => {
    const data = new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer;
    const hash = await sha256Hash(data);
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });
});
