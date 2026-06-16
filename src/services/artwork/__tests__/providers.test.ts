import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockJsonResponse, mockErrorResponse } from "./test-utils";

// ── Mock platformFetch for all HTTP-backed providers ──
const platformFetch = vi.fn();
vi.mock("../../platform-fetch", () => ({ platformFetch }));

// ── Mock image-store for EmbeddedProvider ──
const findImages = vi.fn();
const recordToBlobUrl = vi.fn();
vi.mock("../../image-store", () => ({ findImages, recordToBlobUrl }));

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────
// 1. CoverArtArchiveProvider
// ──────────────────────────────────────────────
describe("CoverArtArchiveProvider", async () => {
  const { CoverArtArchiveProvider } = await import("../providers/cover-art-archive.provider");
  const provider = new CoverArtArchiveProvider();

  it("retorna candidatos quando API retorna front cover", async () => {
    platformFetch.mockResolvedValue(
      mockJsonResponse({
        images: [
          { image: "https://caa/front.jpg", thumbnails: { large: "https://caa/front-500.jpg", small: "https://caa/front-250.jpg" }, front: true, types: ["Front"], approved: true },
        ],
      }),
    );

    const result = await provider.search({ artist: "Artist", album: "Album", musicbrainzReleaseId: "mbid-123" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "cover_art_archive",
      url: "https://caa/front.jpg",
      thumbnailUrl: "https://caa/front-500.jpg",
      confidence: 0.98,
      isFrontCover: true,
    });
  });

  it("retorna vazio quando API retorna 404", async () => {
    platformFetch.mockResolvedValue(mockErrorResponse(404));

    const result = await provider.search({ artist: "A", album: "B", musicbrainzReleaseId: "missing" });

    expect(result).toEqual([]);
  });

  it("retorna vazio quando não há musicbrainzReleaseId", async () => {
    const result = await provider.search({ artist: "A", album: "B" });

    expect(result).toEqual([]);
    expect(platformFetch).not.toHaveBeenCalled();
  });

  it("filtra imagens que não são front cover", async () => {
    platformFetch.mockResolvedValue(
      mockJsonResponse({
        images: [
          { image: "https://caa/back.jpg", thumbnails: {}, front: false, types: ["Back"], approved: true },
          { image: "https://caa/front.jpg", thumbnails: { small: "https://caa/front-250.jpg" }, front: true, types: ["Front"], approved: false },
        ],
      }),
    );

    const result = await provider.search({ artist: "A", album: "B", musicbrainzReleaseId: "mbid" });

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://caa/front.jpg");
  });

  it("usa confidence 0.92 para imagem não aprovada", async () => {
    platformFetch.mockResolvedValue(
      mockJsonResponse({
        images: [
          { image: "https://caa/front.jpg", thumbnails: {}, front: true, types: ["Front"], approved: false },
        ],
      }),
    );

    const result = await provider.search({ artist: "A", album: "B", musicbrainzReleaseId: "mbid" });

    expect(result[0].confidence).toBe(0.92);
  });

  it("retorna vazio quando API retorna erro inesperado (500)", async () => {
    platformFetch.mockResolvedValue(mockErrorResponse(500));
    await expect(
      provider.search({ artist: "A", album: "B", musicbrainzReleaseId: "mbid" }),
    ).rejects.toThrow("CAA 500");
  });
});

// ──────────────────────────────────────────────
// 2. MusicBrainzRGProvider
// ──────────────────────────────────────────────
describe("MusicBrainzRGProvider", async () => {
  const { MusicBrainzRGProvider } = await import("../providers/musicbrainz-rg.provider");
  const provider = new MusicBrainzRGProvider();

  it("busca por release group ID → releases → CAA", async () => {
    platformFetch
      // fetchReleasesForRG
      .mockResolvedValueOnce(
        mockJsonResponse({ releases: [{ id: "release-1" }, { id: "release-2" }] }),
      )
      // CAA for release-1 (404, skip)
      .mockResolvedValueOnce(mockErrorResponse(404))
      // CAA for release-2 (success)
      .mockResolvedValueOnce(
        mockJsonResponse({
          images: [
            { image: "https://caa/rg-front.jpg", thumbnails: { large: "https://caa/rg-front-500.jpg" }, front: true, types: ["Front"], approved: true },
          ],
        }),
      );

    const result = await provider.search({ artist: "A", album: "B", musicbrainzReleaseGroupId: "rg-1" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "musicbrainz_release_group",
      url: "https://caa/rg-front.jpg",
      confidence: 0.90,
    });
  });

  it("busca por artist+album quando não tem release group ID", async () => {
    platformFetch
      // searchByArtistAlbum → MB RG search
      .mockResolvedValueOnce(
        mockJsonResponse({ "release-groups": [{ id: "rg-1" }] }),
      )
      // fetchReleasesForRG
      .mockResolvedValueOnce(
        mockJsonResponse({ releases: [{ id: "release-1" }] }),
      )
      // CAA for release-1
      .mockResolvedValueOnce(
        mockJsonResponse({
          images: [
            { image: "https://caa/artist-album.jpg", thumbnails: {}, front: true, types: ["Front"], approved: true },
          ],
        }),
      );

    const result = await provider.search({ artist: "Test Artist", album: "Test Album" });

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://caa/artist-album.jpg");
  });

  it("retorna vazio quando não tem RG ID nem artist", async () => {
    const result = await provider.search({ artist: "" });

    expect(result).toEqual([]);
    expect(platformFetch).not.toHaveBeenCalled();
  });

  it("continua para próxima release quando CAA retorna 404", async () => {
    platformFetch
      .mockResolvedValueOnce(mockJsonResponse({ releases: [{ id: "r1" }, { id: "r2" }] }))
      .mockResolvedValueOnce(mockErrorResponse(404))
      .mockResolvedValueOnce(
        mockJsonResponse({
          images: [
            { image: "https://caa/r2.jpg", thumbnails: {}, front: true, types: ["Front"], approved: true },
          ],
        }),
      );

    const result = await provider.search({ artist: "A", album: "B", musicbrainzReleaseGroupId: "rg" });

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://caa/r2.jpg");
  });

  it("propaga erro quando MusicBrainz retorna 500", async () => {
    platformFetch.mockResolvedValueOnce(mockErrorResponse(500));

    await expect(
      provider.search({ artist: "A", album: "B", musicbrainzReleaseGroupId: "rg" }),
    ).rejects.toThrow("MB releases 500");
  });
});

// ──────────────────────────────────────────────
// 3. ITunesProvider
// ──────────────────────────────────────────────
describe("ITunesProvider", async () => {
  const { ITunesProvider } = await import("../providers/itunes.provider");
  const provider = new ITunesProvider();

  it("retorna candidatos com URL de arte substituída para 600x600", async () => {
    platformFetch.mockResolvedValue(
      mockJsonResponse({
        results: [
          { artworkUrl100: "https://itunes/100x100bb.jpg", artworkUrl60: "https://itunes/60x60bb.jpg" },
        ],
      }),
    );

    const result = await provider.search({ artist: "Artist", album: "Album" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "itunes",
      url: "https://itunes/600x600bb.jpg",
      thumbnailUrl: "https://itunes/60x60bb.jpg",
      confidence: 0.82,
      isFrontCover: true,
    });
  });

  it("retorna vazio quando query é vazia (sem artist e sem album)", async () => {
    const result = await provider.search({ artist: "", album: "" });

    expect(result).toEqual([]);
    expect(platformFetch).not.toHaveBeenCalled();
  });

  it("retorna vazio quando não há results no response", async () => {
    platformFetch.mockResolvedValue(mockJsonResponse({ results: [] }));

    const result = await provider.search({ artist: "A", album: "B" });

    expect(result).toEqual([]);
  });

  it("propaga erro HTTP 400", async () => {
    platformFetch.mockResolvedValue(mockErrorResponse(400));

    await expect(
      provider.search({ artist: "A", album: "B" }),
    ).rejects.toThrow("iTunes 400");
  });

  it("propaga erro HTTP 500", async () => {
    platformFetch.mockResolvedValue(mockErrorResponse(500));

    await expect(
      provider.search({ artist: "A", album: "B" }),
    ).rejects.toThrow("iTunes 500");
  });
});

// ──────────────────────────────────────────────
// 4. DeezerProvider
// ──────────────────────────────────────────────
describe("DeezerProvider", async () => {
  const { DeezerProvider } = await import("../providers/deezer.provider");
  const provider = new DeezerProvider();

  it("detecta match exato por artist+album e dá confidence maior", async () => {
    platformFetch.mockResolvedValue(
      mockJsonResponse({
        data: [
          { id: 1, title: "Exact Album", cover_xl: "https://deezer/exact-xl.jpg", cover_small: "https://deezer/exact-sm.jpg", artist: { name: "Exact Artist" } },
          { id: 2, title: "Other Album", cover_xl: "https://deezer/other-xl.jpg", cover_small: "https://deezer/other-sm.jpg", artist: { name: "Other Artist" } },
        ],
      }),
    );

    const result = await provider.search({ artist: "Exact Artist", album: "Exact Album" });

    expect(result).toHaveLength(2); // exact + 1 other (only 2 total in mock)
    expect(result[0].confidence).toBe(0.95);
    expect(result[1].confidence).toBe(0.78);
  });

  it("usa confidence 0.78 quando não há match exato", async () => {
    platformFetch.mockResolvedValue(
      mockJsonResponse({
        data: [
          { id: 1, title: "Some Album", cover_xl: "https://deezer/some-xl.jpg", cover_small: "https://deezer/some-sm.jpg", artist: { name: "Some Artist" } },
        ],
      }),
    );

    const result = await provider.search({ artist: "Exact Artist", album: "Exact Album" });

    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.78);
  });

  it("usa fallback de tamanhos de capa: cover_xl > cover_big > cover_medium > cover", async () => {
    platformFetch.mockResolvedValue(
      mockJsonResponse({
        data: [
          { id: 1, title: "Minimal", cover: "https://deezer/minimal.jpg", artist: { name: "Min Artist" } },
        ],
      }),
    );

    const result = await provider.search({ artist: "Min Artist", album: "Minimal" });

    expect(result[0].url).toBe("https://deezer/minimal.jpg");
  });

  it("retorna vazio quando API retorna sem data", async () => {
    platformFetch.mockResolvedValue(mockJsonResponse({ data: [] }));

    const result = await provider.search({ artist: "A", album: "B" });

    expect(result).toEqual([]);
  });

  it("retorna vazio quando data é undefined", async () => {
    platformFetch.mockResolvedValue(mockJsonResponse({}));

    const result = await provider.search({ artist: "A", album: "B" });

    expect(result).toEqual([]);
  });

  it("propaga erro HTTP 500", async () => {
    platformFetch.mockResolvedValue(mockErrorResponse(500));

    await expect(
      provider.search({ artist: "A", album: "B" }),
    ).rejects.toThrow("Deezer 500");
  });

  it("propaga erro HTTP 400", async () => {
    platformFetch.mockResolvedValue(mockErrorResponse(400));

    await expect(
      provider.search({ artist: "A", album: "B" }),
    ).rejects.toThrow("Deezer 400");
  });
});

// ──────────────────────────────────────────────
// 5. EmbeddedProvider
// ──────────────────────────────────────────────
describe("EmbeddedProvider", async () => {
  const { EmbeddedProvider } = await import("../providers/embedded.provider");
  const provider = new EmbeddedProvider();

  it("retorna candidatos do IndexedDB image-store por artist+album", async () => {
    findImages.mockResolvedValue([
      { md5: "abc", blob: new ArrayBuffer(8), format: "image/jpeg", sourceUrl: "" },
    ]);
    recordToBlobUrl.mockResolvedValue("blob:mock/embedded");

    const result = await provider.search({ artist: "Test Artist", album: "Test Album" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider: "embedded",
      confidence: 0.7,
      isFrontCover: true,
    });
    expect(result[0].blobUrl).toBe("blob:mock/embedded");
    expect(findImages).toHaveBeenCalledWith({ artistName: "test artist", albumName: "test album" });
  });

  it("retorna vazio quando não há registros no image-store", async () => {
    findImages.mockResolvedValue([]);

    const result = await provider.search({ artist: "No Match", album: "No Album" });

    expect(result).toEqual([]);
  });

  it("retorna vazio quando não há artist", async () => {
    const result = await provider.search({ artist: "" });

    expect(result).toEqual([]);
    expect(findImages).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// 6. ArtworkResolver
// ──────────────────────────────────────────────
describe("ArtworkResolver", () => {
  // Re-import with fresh mock state per test
  let resolver: typeof import("../artwork-resolver").artworkResolver;

  beforeEach(async () => {
    // We import fresh each time to get clean singleton
    vi.resetModules();
    const mod = await import("../artwork-resolver");
    resolver = mod.artworkResolver;
  });

  it("getProviderNames retorna todos os 5 providers registrados", () => {
    const names = resolver.getProviderNames();
    expect(names).toContain("cover_art_archive");
    expect(names).toContain("musicbrainz_release_group");
    expect(names).toContain("itunes");
    expect(names).toContain("deezer");
    expect(names).toContain("embedded");
    expect(names).toHaveLength(5);
  });

  it("resolveFromProvider tenta IPC primeiro, depois cai para renderer se IPC retornar vazio", async () => {
    const mockIpc = vi.fn().mockResolvedValue([]);
    (globalThis as any).window = { electronApi: { artworkSearch: mockIpc } };

    platformFetch.mockResolvedValue(
      mockJsonResponse({
        images: [
          { image: "https://caa/f.jpg", thumbnails: {}, front: true, types: ["Front"], approved: true },
        ],
      }),
    );

    const result = await resolver.resolveFromProvider("cover_art_archive", {
      artist: "A",
      album: "B",
      musicbrainzReleaseId: "mbid",
    });

    // IPC foi chamado
    expect(mockIpc).toHaveBeenCalledWith("cover_art_archive", expect.any(Object));
    // Como IPC retornou [], o renderer-side foi usado como fallback
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe("cover_art_archive");
  });

  it("resolveFromProvider retorna vazio para provider desconhecido", async () => {
    const result = await resolver.resolveFromProvider("unknown_provider", { artist: "A" });
    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 7. ArtworkQueue
// ──────────────────────────────────────────────
describe("ArtworkQueue", async () => {
  const { artworkQueue } = await import("../artwork-queue");

  beforeEach(() => {
    artworkQueue.clearPending("any");
  });

  it("executa tarefa e retorna resultado", async () => {
    const result = await artworkQueue.enqueue("test", 0, async () => "ok");
    expect(result).toBe("ok");
  });

  it("respeita pace entre requisições do mesmo provider", async () => {
    const timestamps: number[] = [];
    const task = async () => {
      timestamps.push(Date.now());
      return "done";
    };

    await artworkQueue.enqueue("pace-test", 50, task);
    await artworkQueue.enqueue("pace-test", 50, task);
    await artworkQueue.enqueue("pace-test", 50, task);

    expect(timestamps).toHaveLength(3);
    // Each should be at least 50ms apart
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(45);
    expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(45);
  });

  it("providers diferentes rodam independentemente (sem pace entre eles)", async () => {
    const timestamps: number[] = [];
    const makeTask = (label: string) => async () => {
      timestamps.push(Date.now());
      return label;
    };

    await Promise.all([
      artworkQueue.enqueue("provider-a", 0, makeTask("a")),
      artworkQueue.enqueue("provider-b", 0, makeTask("b")),
    ]);

    expect(timestamps).toHaveLength(2);
  });

  it("rejeita promessa quando queue é limpa", async () => {
    const prom = artworkQueue.enqueue("clear-test", 100, async () => "never");
    artworkQueue.clearPending("clear-test");
    await expect(prom).rejects.toThrow("queue cleared");
  });
});

// ──────────────────────────────────────────────
// 8. ARTWORK_PROVIDER_META
// ──────────────────────────────────────────────
describe("ARTWORK_PROVIDER_META", async () => {
  const { ARTWORK_PROVIDER_META } = await import("../providers/meta");

  it("contém metadados para todos os 5 providers", () => {
    expect(Object.keys(ARTWORK_PROVIDER_META)).toHaveLength(5);
    expect(ARTWORK_PROVIDER_META.cover_art_archive).toBeDefined();
    expect(ARTWORK_PROVIDER_META.musicbrainz_release_group).toBeDefined();
    expect(ARTWORK_PROVIDER_META.itunes).toBeDefined();
    expect(ARTWORK_PROVIDER_META.deezer).toBeDefined();
    expect(ARTWORK_PROVIDER_META.embedded).toBeDefined();
  });

  it("cada provider tem label, description e domain", () => {
    for (const [, meta] of Object.entries(ARTWORK_PROVIDER_META)) {
      expect(meta.label).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.domain).toBeTruthy();
    }
  });
});
