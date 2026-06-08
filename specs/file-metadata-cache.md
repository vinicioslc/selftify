# Spec: File Metadata Cache (FileTags) with TTL

> **Status**: draft
> **Last update**: 2026-06-04
> **Tipos**: `FileTags`, `SongDTO` — ver `event-hooks.md:1`
> **Integração**: `enrichWithFileTags()` — ver `event-hooks.md:7`

## Problem

O scanner atual guarda só campos superficiais no Dexie (`duration`, `bitrate`, `genre`, `year`). Metadados pesados — BPM, letra, compositor, cover art embedada — são descartados. Reler o MP3 a cada renderização custa ~100-200ms por arquivo.

## Solução

Cache com TTL no Dexie. API:

```typescript
const tags = await cachedFileTags(filePath, 3600_000, () => extractFromFile(filePath));
```

---

## 1. API

```typescript
// src/services/file-metadata-cache.ts

function cachedFileTags(
  key: string,           // filePath ou songId
  ttl: number,           // ms (ex: 3600_000 = 1h)
  loader: () => Promise<Partial<FileTags> | null>
): Promise<Partial<FileTags> | null>;

function invalidateFileTags(key: string): Promise<void>;
function clearFileTagsCache(): Promise<void>;
function pruneExpiredFileTags(): Promise<void>;
```

---

## 2. Storage

### Tabela no Dexie (schema v5)

```typescript
this.version(5).stores({
  songs: "id, &path, name, artist_name, album_name, genre, mbz_album_id, mbz_artist_id, mbz_recording_id",
  artists: "id, name, mbz_artist_id",
  scan_state: "id",
  scan_queue: "++id",
  mbz_metadata_cache: "key",
  mbz_search_cache: "key, expires_at",
  file_tags_cache: "key, expires_at",       // ← nova
});
```

### Tipo

```typescript
export type FileTagsCacheEntry = {
  key: string;
  data: string;        // FileTags serializado como JSON
  expires_at: number;
  cached_at: number;
};
```

> `FileTags.coverArt` contém `{ hash, format }` (apenas referência). As bytes brutas estão na cache de cover art dedicada (`mp3-cover-art-cache.md`). Isso evita duplicação e overhead de base64 no JSON do Dexie.

---

## 3. Fluxo

```
cachedFileTags(key, ttl, loader)
       │
       ▼
┌──────────────────┐
│  Dexie lookup    │
│  key + não exp.  │─── sim ──→ retorna data
└──────┬───────────┘
       │ não
       ▼
┌──────────────────┐
│  Executa loader  │─── erro/null ──→ retorna null (não cacheia)
└──────┬───────────┘
       │ ok
       ▼
┌──────────────────┐
│  Salva no Dexie  │
│  key, data, ttl  │
└──────┬───────────┘
       ▼
    retorna data
```

---

## 4. TTL por Contexto

| Contexto | TTL |
|---|---|
| Listagem biblioteca / álbuns / artistas | 5 min |
| Detalhe da música / full-screen player | 5 min |
| Playlist | 5 min |
| Re-scan completo | invalida tudo |
| Exportar / compartilhar | loader sempre fresco (ttl=0) |

---

## 5. Integração

`enrichWithFileTags()` (ver `event-hooks.md:7`) é chamada **sob demanda** por componentes que precisam dos metadados estendidos — nunca em listagens. Internamente chama `cachedFileTags()`.

```typescript
// src/services/song-mapper.ts
async function enrichWithFileTags(dto: SongDTO): Promise<SongDTO> {
  if (!dto.filePath) return dto;
  const tags = await cachedFileTags(dto.filePath, 300_000, () =>
    extractFileTags(dto.filePath)
  );
  return { ...dto, ...(tags ? { enrich: tags } : {}) }; // campos mergeados
}
```

---

## 6. Invalidation

| Evento | Ação |
|---|---|
| Re-scan completo (`library:scan-start`) | `clearFileTagsCache()` |
| Arquivo modificado (watcher) | `invalidateFileTags(filePath)` |
| TTL expira | Próxima leitura executa loader |
| App iniciando | `pruneExpiredFileTags()` |

---

## 7. Edge Cases

| Cenário | Comportamento |
|---|---|
| Loader lança exceção | Retorna `null`, cache **não** escrito |
| Loader retorna `null` | Retorna `null`, cache **não** escrito |
| Múltiplas chamadas simultâneas | In-flight dedup (promise caching) |
| TTL = 0 | Sempre executa loader (bypass) |
| `filePath` não existe mais | Loader → null, cache não escrito |

---

## 8. Arquivos

| Arquivo | Ação |
|---|---|
| `src/services/file-metadata-cache.ts` | **CRIAR** — `cachedFileTags()`, `invalidateFileTags()`, `clearFileTagsCache()`, `pruneExpiredFileTags()` |
| `src/services/local-database.ts` | **MODIFICAR** — schema v5, tabela `file_tags_cache` |
| `src/services/local-database-types.ts` | **MODIFICAR** — tipo `FileTagsCacheEntry` |
| `src/services/song-mapper.ts` | **MODIFICAR** — `enrichWithFileTags()` (assinatura em `event-hooks.md:7`) |
| `src/api/indexer/local-indexer.ts` | **MODIFICAR** — chamar `clearFileTagsCache()` no re-scan |
