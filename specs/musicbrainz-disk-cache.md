# MusicBrainz Disk Cache — Cache de Metadados em Disco

## Problem

Atualmente, metadados do MusicBrainz ficam em cache apenas em IndexedDB (`mbz_metadata_cache` + `mbz_search_cache`) com TTL único (`cacheTtlMinutes`). Isso significa que:

1. Ao limpar dados do navegador, reinstalar o app, ou trocar de máquina, todo cache é perdido
2. Requests ao MusicBrainz são refeitas mesmo para dados já buscados anteriormente
3. O cache é um blob sem estrutura por artista — difícil de inspecionar/gerenciar

## Solution

Criar `db.<mbid>.selftify` dentro da pasta de cada artista na biblioteca local, contendo todos os metadados daquele artista obtidos via MusicBrainz, organizados por chave de endpoint (`art-{mbid}`, `rel-{mbid}`, etc.).

### Cache Lookup Chain

Para endpoints cobertos pelo disco, a ordem de lookup é:

```
1. LRU em memória (mais rápido)
2. <library>/<Artista>/db.<mbid>.selftify (disco persistente)
3. IndexedDB mbz_metadata_cache (fallback)
4. MusicBrainz API (último recurso)
```

### File Location

```
<library_root>/<Artista>/db.<mbid_last8>.selftify
```

- `<library_root>`: `folderPath` da origin LOCAL
- `<Artista>`: nome do artista (sanitizado — remove `\/?%*:|"<>`)
- `<mbid_last8>`: últimos 8 caracteres do MBID do artista (para disambiguação de nome)

Fallback sem MBID:
```
<library_root>/<Artista>/db.selftify
```

### File Format

```json
{
  "art-mbid123": {
    "data": { "id": "mbid123", "name": "Mozart", "type": "Person", ... },
    "createdAt": 1712345678000
  },
  "rg-art-mbid123-25-0": {
    "data": { "created": "...", "count": 42, "release-groups": [...] },
    "createdAt": 1712345678000
  },
  "rel-mbid456": {
    "data": { "id": "mbid456", "title": "Requiem", ... },
    "createdAt": 1712345680000
  },
  "_updatedAt": 1712345680000
}
```

Cada chave é o mesmo identificador de endpoint usado em `musicbrainz-cache.ts`:
| Key pattern | Endpoint |
|-------------|----------|
| `art-{artistMbid}` | `getArtistDetail()` |
| `rg-art-{artistMbid}-{limit}-{offset}` | `getArtistReleaseGroups()` |
| `rel-{releaseMbid}` | `getReleaseDetail()` |
| `rec-{recordingMbid}` | `getRecordingDetail()` |
| `rel-rg-{rgId}` | `getReleaseByReleaseGroup()` |

Funções de search (`searchRecordings`, `searchReleases`, `searchArtists`) **não** são cobertas pelo disco — usam apenas IndexedDB.

---

### Files Changed

| File | Change |
|------|--------|
| `specs/musicbrainz-disk-cache.md` | **Create** — this spec |
| `specs/musicbrainz-disk-cache.ui.md` | **Create** — UI spec for settings |
| `src/services/musicbrainz-disk-cache.ts` | **Create** — core service |
| `src/stores/settings.store.ts` | Modify — add `musicbrainzCacheTtl` + action |
| `src/services/musicbrainz-cache.ts` | Modify — add `getDiskTtlMs()` |
| `src/services/musicbrainz-client.ts` | Modify — add `MusicBrainzContext` + disk cache |
| `src/features/settings/settings-page.tsx` | Modify — add TTL radio buttons |
| `src/features/artist/artist-page.tsx` | Modify — pass artist context |
| `src/api/indexer/local-indexer.ts` | Modify — pass artist context |
| `src/services/download-queue.ts` | Modify — pass artist context |
| `src/features/album/album-page.tsx` | Modify — pass artist context |

---

### Behavior

#### Lookup Flow (ex: getArtistDetail)

```
getArtistDetail(artistMbid, ctx={ artistName: "Mozart" })
  │
  ├─ key = "art-" + artistMbid
  ├─ 1. LRU (memória) → busca por key
  │   └─ hit && dentro do TTL? → retorna
  ├─ 2. Disk cache (ctx.artistName + key)
  │   ├─ mount path: <root>/Mozart/db.<mbid>.selftify
  │   ├─ read file → JSON.parse → busca key
  │   ├─ key existe && createdAt + TTL > now?
  │   │   └─ sim → popula LRU, retorna
  │   └─ não existe ou expirado → continua
  ├─ 3. IndexedDB (mbz_metadata_cache)
  │   └─ existe? → retorna
  ├─ 4. MusicBrainz API → fetch
  │   ├─ LRU.set(key, data)
  │   ├─ IndexedDB.set(key, data)
  │   └─ ctx? → diskCache.set(artistName, key, data)
  └─ retorna data
```

#### Write Flow

Quando uma função com `MusicBrainzContext` faz fetch da API:
1. Salva em LRU (existente)
2. Salva em IndexedDB (existente)
3. Salva em disco: lê `db.<mbid>.selftify` → add/update entry → write

#### TTL

Setting `musicbrainzCacheTtl` é independente do `cacheTtlMinutes` geral. Opções:

| Valor | Significado |
|-------|------------|
| `"1min"` | 60 segundos |
| `"15min"` | 15 minutos |
| `"30min"` | 30 minutos |
| `"never"` | Cache nunca expira |

**Invalidação**: se TTL muda de `"never"` para qualquer outro valor, limpa todo cache em disco (deleta todos os arquivos `**/db.*.selftify` e `**/db.selftify`).

#### Concorrência

Usar **WriteQueue** (Promise chain) por path de arquivo. Se duas operações tentarem escrever no mesmo `db.selftify` simultaneamente, a segunda encadeia após a primeira:

```ts
private writeQueue = new Map<string, Promise<void>>();

async write(artistName: string, cache: ArtistCache): Promise<void> {
  const path = this.filePath(artistName);
  const prev = this.writeQueue.get(path) ?? Promise.resolve();
  const next = prev.then(() => this.doWrite(path, cache));
  this.writeQueue.set(path, next);
  return next;
}
```

#### MusicBrainzContext

Tipo opcional passado para funções do `musicbrainz-client.ts`:

```ts
export type MusicBrainzContext = {
  artistName: string;
};
```

Apenas funções que podem ser atribuídas a um artista recebem este parâmetro: `getArtistDetail`, `getArtistReleaseGroups`, `getReleaseDetail`, `getRecordingDetail`, `getReleaseByReleaseGroup`.

Funções de search NÃO recebem — continuam apenas com IndexedDB.

Quando `ctx` não é fornecido, o comportamento é idêntico ao atual (LRU → IndexedDB → API).

#### Platform

Usa `PlatformService.{readFile, writeFile, fileExists, createDirectory}` — funciona em Electron, Capacitor e Web (web fallback sempre falha, o que é aceitável).

#### Edge Cases

| Caso | Comportamento |
|------|---------------|
| JSON corrompido | Deleta o arquivo, recria do zero |
| Library root não configurado | `ctx` não é passado → fluxo cai para IndexedDB+API |
| Artista sem MBID | Usa `db.selftify` (sem sufixo), nunca busca API |
| Arquivo não existe | `readFile` retorna null → considerado cache vazio |
| Escrita falha | Loga warning, cache em disco perdido mas LRU+IDB ainda funcionam |
| Nome de artista com caracteres especiais | Sanitiza: `/`, `\`, `?`, `%`, `*`, `:`, `|`, `"`, `<`, `>` → `_` |
| Múltiplos library roots | Cada library tem sua própria árvore de cache independente |
