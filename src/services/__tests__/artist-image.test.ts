import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only the external modules — test the real logic of artist-image.ts
vi.mock("../image-fetch", () => ({
  fetchImageAsBlobUrl: vi.fn((url: string) => {
    if (url.startsWith("https://upload.wikimedia.org/") || url.startsWith("https://commons.wikimedia.org/")) {
      const filename = url.split("/").pop() || "image";
      return Promise.resolve(`blob:mock/${filename}`);
    }
    return Promise.resolve(null);
  }),
}));

vi.mock("../platform-fetch", () => ({
  platformFetch: vi.fn(),
}));

import { platformFetch } from "../platform-fetch";
import { fetchArtistImage } from "../artist-image";

function mockJsonResponse(data: unknown) {
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

function mockErrorResponse(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error("not ok")),
    headers: {},
    text: () => Promise.resolve(""),
    blob: () => Promise.resolve(new Blob()),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchArtistImage — Wikipedia fallback", () => {
  it("retorna blob URL quando Wikipedia tem thumbnail para o artista", async () => {
    (platformFetch as any).mockImplementation((url: string) => {
      if (url.includes("en.wikipedia.org/w/api.php")) {
        return Promise.resolve(mockJsonResponse({
          query: {
            pages: {
              "123": {
                pageid: 123,
                title: "Trapt",
                thumbnail: {
                  source: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Trapt_performing_2013.jpg/250px-Trapt_performing_2013.jpg",
                  width: 250,
                  height: 333,
                },
              },
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    const result = await fetchArtistImage("Trapt");
    expect(result).toMatch(/^blob:/);
  });

  it("retorna null quando Wikipedia não tem página para o artista", async () => {
    (platformFetch as any).mockImplementation((url: string) => {
      if (url.includes("en.wikipedia.org/w/api.php")) {
        return Promise.resolve(mockJsonResponse({
          query: { pages: { "999": { missing: true, title: "NonExistentArtist" } } },
        }));
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    const result = await fetchArtistImage("NonExistentArtist");
    expect(result).toBeNull();
  });

  it("retorna null quando Wikipedia retorna HTTP 500", async () => {
    (platformFetch as any).mockImplementation((url: string) => {
      if (url.includes("en.wikipedia.org/w/api.php")) {
        return Promise.resolve(mockErrorResponse(500));
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    const result = await fetchArtistImage("Error500Artist");
    expect(result).toBeNull();
  });

  it("retorna null quando Wikipedia lança exceção de rede", async () => {
    (platformFetch as any).mockRejectedValue(new Error("network error"));
    const result = await fetchArtistImage("NetworkErrorArtist");
    expect(result).toBeNull();
  });
});

describe("fetchArtistImage — Wikidata by MBID", () => {
  it("resolve imagem por MBID via Wikidata P434 → Commons", async () => {
    (platformFetch as any).mockImplementation((url: string) => {
      if (url.includes("query.wikidata.org/sparql")) {
        return Promise.resolve(mockJsonResponse({
          results: { bindings: [{ image: { value: "Trapt performing 2013.jpg" } }] },
        }));
      }
      if (url.includes("commons.wikimedia.org/w/api.php")) {
        return Promise.resolve(mockJsonResponse({
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
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    const result = await fetchArtistImage("Trapt", "8876c0be-ccff-4d46-aa91-7f935a3b3b6b");
    expect(result).toMatch(/^blob:/);
  });

  it("fallback para Wikipedia quando Wikidata retorna sem imagem (P18 ausente)", async () => {
    let callCount = 0;
    (platformFetch as any).mockImplementation((url: string) => {
      callCount++;
      if (url.includes("query.wikidata.org/sparql") && url.includes("p18-absent-mbid")) {
        // Sem P18 — retorna binding sem campo "image"
        return Promise.resolve(mockJsonResponse({
          results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q999" } }] },
        }));
      }
      if (url.includes("commons.wikimedia.org/w/api.php")) {
        // Commons também falha (porque não tem P18, esse caminho não é alcançado)
        return Promise.resolve(mockErrorResponse(404));
      }
      if (url.includes("en.wikipedia.org/w/api.php")) {
        return Promise.resolve(mockJsonResponse({
          query: {
            pages: {
              "123": {
                pageid: 123,
                title: "FallbackArtist",
                thumbnail: {
                  source: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/FallbackArtist.jpg/250px-FallbackArtist.jpg",
                },
              },
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected call #${callCount}: ${url}`));
    });

    const result = await fetchArtistImage("FallbackArtist", "p18-absent-mbid");
    expect(result).toMatch(/^blob:/);
    // Wikipedia foi chamada (fallback depois de Wikidata não ter P18)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("fallback para Wikipedia quando Wikidata SPARQL retorna erro", async () => {
    let callCount = 0;
    (platformFetch as any).mockImplementation((url: string) => {
      callCount++;
      if (url.includes("query.wikidata.org/sparql")) {
        return Promise.resolve(mockErrorResponse(500));
      }
      if (url.includes("en.wikipedia.org/w/api.php")) {
        return Promise.resolve(mockJsonResponse({
          query: {
            pages: {
              "123": {
                pageid: 123,
                title: "Some Artist",
                thumbnail: {
                  source: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/c.jpg/250px-c.jpg",
                },
              },
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected call #${callCount}: ${url}`));
    });

    const result = await fetchArtistImage("Some Artist", "some-mbid");
    expect(result).toMatch(/^blob:/);
  });
});

describe("fetchArtistImage — cache sem request repetido", () => {
  it("usa cache do Wikipedia em chamadas subsequentes (sem platformFetch duplicado)", async () => {
    let callCount = 0;
    let wikiCallCount = 0;
    (platformFetch as any).mockImplementation((url: string) => {
      callCount++;
      if (url.includes("en.wikipedia.org/w/api.php")) {
        wikiCallCount++;
        return Promise.resolve(mockJsonResponse({
          query: {
            pages: {
              "123": {
                pageid: 123,
                title: "CacheTest",
                thumbnail: {
                  source: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/c.jpg/250px-c.jpg",
                },
              },
            },
          },
        }));
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });

    // Primeira chamada — faz fetch real
    const first = await fetchArtistImage("CacheTest");
    expect(first).toMatch(/^blob:/);
    expect(wikiCallCount).toBe(1);

    // Segunda chamada com mesmo nome — usa cache, não chama Wikipedia
    const second = await fetchArtistImage("CacheTest");
    expect(second).toMatch(/^blob:/);
    expect(wikiCallCount).toBe(1); // Wikipedia não foi chamado de novo
  });
});
