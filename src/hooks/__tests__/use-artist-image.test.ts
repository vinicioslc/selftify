import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the external dependencies — the hook itself is the "implementation under test"
vi.mock("../../services/image-cache", () => ({
  fetchImageAsBlobUrl: vi.fn((url: string) => {
    if (url && url.startsWith("https://upload.wikimedia.org/"))
      return Promise.resolve(`blob:mock/${url.split("/").pop()}`);
    if (url && url.startsWith("https://commons.wikimedia.org/"))
      return Promise.resolve(`blob:mock/${url.split("/").pop()}`);
    return Promise.resolve(null);
  }),
}));

vi.mock("../../services/platform-fetch", () => ({
  platformFetch: vi.fn(),
}));

import { platformFetch } from "../../services/platform-fetch";

function mockResolvedJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    headers: {},
    text: () => Promise.resolve(JSON.stringify(data)),
    blob: () => Promise.resolve(new Blob()),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useArtistImage — internal logic", () => {
  it("resolve imagem de artista de um MBID conhecido", async () => {
    // Simula a cadeia Wikidata → Commons
    (platformFetch as any).mockImplementation((url: string) => {
      if (url.includes("query.wikidata.org/sparql") && url.includes("8876c0be")) {
        return Promise.resolve(mockResolvedJson({
          results: { bindings: [{ image: { value: "Trapt performing 2013.jpg" } }] },
        }));
      }
      if (url.includes("commons.wikimedia.org/w/api.php") && url.includes("Trapt_performing_2013")) {
        return Promise.resolve(mockResolvedJson({
          query: {
            pages: {
              "123": {
                pageid: 123,
                title: "File:Trapt_performing_2013.jpg",
                imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/6/6c/Trapt_performing_2013.jpg" }],
              },
            },
          },
        }));
      }
      // Fallback Wikipedia (não deve ser chamado se Wikidata funcionar)
      if (url.includes("en.wikipedia.org/w/api.php")) {
        return Promise.resolve(mockResolvedJson({
          query: {
            pages: {
              "456": {
                pageid: 456,
                title: "Trapt",
                thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Trapt_performing_2013.jpg/250px-Trapt_performing_2013.jpg" },
              },
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    // Importa e usa fetchArtistImage que é a base do hook
    const { fetchArtistImage } = await import("../../services/artist-image");
    const result = await fetchArtistImage("Trapt", "8876c0be-ccff-4d46-aa91-7f935a3b3b6b");
    expect(result).toMatch(/^blob:/);
  });

  it("resolve imagem de artista usando fallback Wikipedia quando sem MBID", async () => {
    (platformFetch as any).mockImplementation((url: string) => {
      if (url.includes("en.wikipedia.org/w/api.php")) {
        return Promise.resolve(mockResolvedJson({
          query: {
            pages: {
              "123": {
                pageid: 123,
                title: "Radiohead",
                thumbnail: {
                  source: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Radiohead_2016.jpg/250px-Radiohead_2016.jpg",
                },
              },
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const { fetchArtistImage } = await import("../../services/artist-image");
    const result = await fetchArtistImage("Radiohead");
    expect(result).toMatch(/^blob:/);
  });

  it("retorna null quando todas as fontes falham", async () => {
    (platformFetch as any).mockRejectedValue(new Error("network timeout"));

    const { fetchArtistImage } = await import("../../services/artist-image");
    const result = await fetchArtistImage("NonExistent");
    expect(result).toBeNull();
  });

  it("cadeia Wikidata → Commons completa sem erro de parse", async () => {
    // Testa o parse real da resposta da Commons API
    (platformFetch as any).mockImplementation((url: string) => {
      if (url.includes("query.wikidata.org/sparql")) {
        return Promise.resolve(mockResolvedJson({
          results: { bindings: [{ image: { value: "Radiohead 2016.jpg" } }] },
        }));
      }
      if (url.includes("commons.wikimedia.org/w/api.php")) {
        return Promise.resolve(mockResolvedJson({
          query: {
            pages: {
              "789": {
                pageid: 789,
                title: "File:Radiohead_2016.jpg",
                imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/1/15/Radiohead_2016.jpg" }],
              },
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const { fetchArtistImage } = await import("../../services/artist-image");
    const result = await fetchArtistImage("Radiohead", "a74b1b7f-71a5-4011-9441-d0b5e4122711");
    expect(result).toMatch(/^blob:/);
    expect(result).toBeTruthy();
  });
});
