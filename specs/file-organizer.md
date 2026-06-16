# File Organizer — Organização Automática de Pastas

## Problema

O sistema atual de scan mantém os arquivos de música exatamente onde estão no disco. O scanner apenas descobre arquivos, extrai metadados e indexa no SQLite. Não há reorganização da estrutura de pastas.

Isso resulta em:

- Estrutura inconsistente quando o usuário adiciona música de fontes diferentes
- Dificuldade de navegação manual no filesystem
- Impossibilidade de usar padrões de ferramentas externas (Kodi, Plex, etc.) que esperam `artist.nfo`, `album.nfo`, `backdrop.jpg`
- Duplicação de lógica de path em `local-controller.ts` (que precisa adivinhar onde cada arquivo está)

## Solução

Um pipeline de organização que transforma qualquer estrutura de entrada na hierarquia padronizada:

```
{Música}/
  └── {Artist}/
        ├── artist.nfo
        ├── backdrop.jpg
        ├── {Album (YYYY)}/
        │     ├── album.nfo
        │     ├── cover.jpg
        │     ├── {Artist} - {Album} - {NN} - {Music}.mp3
        │     ├── {Artist} - {Album} - {NN} - {Music}.lrc
        │     └── ...
        └── {Album2 (YYYY)}/
              └── ...
```

### Padrão de saída para arquivos de áudio

```
{Artist} - {Album} - {NN} - {Title}.{ext}
```

### Padrão de saída para pastas de álbum

```
{Album} ({YYYY})/
```

Se o ano não estiver disponível:

```
{Album}/
```

Se o álbum não estiver disponível (single avulso):

```
Unknown Album/
```

Se artista não estiver disponível:

```
Unknown Artist/
```

### Padrão de saída para pastas de artista

```
{Artist}/
```

## Arquitetura

```
Scanner (local-indexer.ts)
    │
    ├── 1. Discover: BFS walk → lista de arquivos de áudio
    │
    ├── 2. Process Batch (lote de 5): para cada arquivo:
    │       ├── Extrair metadados (music-metadata via IPC ou renderer)
    │       ├── Acumular em pendingAlbums (como hoje)
    │       └── Enfileirar OrgTask em OrganizationQueue
    │
    ├── 3. Flush OrganizationQueue:
    │       ├── Processar cada OrgTask sequencialmente
    │       ├── Construir target path
    │       ├── Mover arquivo (rename/move via PlatformService)
    │       ├── Mover sidecars (.lrc, etc.)
    │       ├── Gerar .nfo se não existir
    │       ├── Extrair cover → cover.jpg
    │       └── Atualizar track.path no pendingAlbums
    │
    └── 4. Finish: escrever SQLite (como hoje), agora com paths atualizados
```

```
┌──────────────────────────────────────────────────────────────────┐
│                        Pipeline                                  │
│                                                                  │
│  Discover → [Enqueue per-file] → Process Metadata → Organize → DB │
│                    ↑                              ↓               │
│              OrganizationQueue              Move files           │
│              (in-memory + persist)          Gen sidecars         │
└──────────────────────────────────────────────────────────────────┘
```

### Diagrama de componentes

```
┌─────────────────────────┐
│   local-indexer.ts      │
│   (scanner engine)      │
│                         │
│  processFile() melhora: │
│  → extrai metadados     │
│  → chama organizer      │
│  → atualiza paths       │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────────┐
│  OrganizationQueue          │
│  (queue.ts)                 │
│                             │
│  Tasks: OrgTask[]           │
│  Persist: org-queue.json    │
│  Process: FIFO sequencial   │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  FileOrganizer              │
│  (file-organizer.ts)        │
│                             │
│  - buildTargetPath()        │
│  - ensureDirectories()      │
│  - moveFile()               │
│  - moveSidecars()           │
│  - writeNfo()               │
│  - extractCover()           │
└─────────────────────────────┘
```

## Componentes Detalhados

### 1. FileOrganizer (`src/services/organizer/file-organizer.ts`)

Módulo central que contém toda a lógica de organização.

```typescript
interface OrganizeContext {
  libraryRoot: string;
  artistName: string;
  albumName: string | null;
  releaseYear: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  trackTitle: string;
  sourcePath: string;          // path absoluto atual
  extension: string;           // .mp3, .flac, etc.
  hasLyrics: boolean;          // se existe .lrc adjacente
  hasEmbeddedCover: boolean;   // se metadados têm picture
  sidecarPaths: string[];      // paths de sidecars encontrados
}

interface OrganizeResult {
  targetPath: string;          // novo path absoluto
  targetAlbumDir: string;      // diretório do álbum (relativo ao root)
  movedSidecars: string[];     // sidecars movidos
  createdFiles: string[];      // .nfo, cover.jpg criados
  skipped: boolean;            // true se já estava organizado
}

function organizeFile(ctx: OrganizeContext): Promise<OrganizeResult>
```

**Regras de `buildTargetPath()`:**

1. Sanitizar cada componente: `name.replace(/[/\\?%*:|"<>]/g, "_").trim()`
2. Artista: `sanitizeForPath(artistName)`
3. Álbum: `sanitizeForPath(albumName)` + se `releaseYear` existir: `" ({releaseYear})"`
4. Nome do arquivo: `"{artistName} - {albumName} - {NN} - {trackTitle}.{ext}"`
   - Se `trackNumber` for nulo: `"{artistName} - {albumName} - {trackTitle}.{ext}"`
   - Se `albumName` for nulo: `"{artistName} - {NN} - {trackTitle}.{ext}"` ou `"{artistName} - {trackTitle}.{ext}"`
5. Path final: `{libraryRoot}/{artistDir}/{albumDir}/{fileName}`

**Regras de `moveFile()`:**

1. Verificar se `sourcePath === targetPath` → skip
2. Verificar se `targetPath` já existe → skip + log warn
3. Criar diretórios necessários via `cachedCreateDirectory()`
4. Executar `cachedRename(sourcePath, targetPath)`
5. Se rename falhar (cross-device), fallback: `readFile → writeFile → deleteFile`

**Sidecars:**

| Sidecar | Origem | Destino | Condição |
|---------|--------|---------|----------|
| `.lrc` | `{sourceDir}/{name}.lrc` | `{targetDir}/{targetName}.lrc` | Se exists |
| `cover.jpg` | Extraído de tag ID3 | `{targetAlbumDir}/cover.jpg` | Se tem embedded cover |
| `artist.nfo` | Gerado | `{targetArtistDir}/artist.nfo` | Sempre |
| `backdrop.jpg` | (futuro: download) | `{targetArtistDir}/backdrop.jpg` | Futuro |
| `album.nfo` | Gerado | `{targetAlbumDir}/album.nfo` | Sempre |

### 2. OrganizationQueue (`src/services/organizer/organization-queue.ts`)

Fila persistente de tarefas de organização.

```typescript
interface OrgTask {
  id: string;                    // hash do sourcePath
  sourcePath: string;
  status: "pending" | "processing" | "done" | "failed";
  error?: string;

  // Metadata já extraída pelo scanner
  artistName: string;
  albumName: string | null;
  releaseYear: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  trackTitle: string;
  extension: string;
}

class OrganizationQueue {
  private tasks: Map<string, OrgTask>;
  private processing: boolean;
  private persistPath: string;  // {libraryRoot}/.selftify/org-queue.json

  async enqueue(task: Omit<OrgTask, "status">): Promise<void>
  async processAll(organizer: FileOrganizer): Promise<OrgTask[]>
  async persist(): Promise<void>
  async load(): Promise<void>
  getPending(): OrgTask[]
  getFailed(): OrgTask[]
  clear(): Promise<void>
}
```

**Regras:**

- `enqueue` adiciona ao Map (deduplicado por sourcePath hash) e persiste
- `processAll` processa FIFO, um por vez, chamando `organizer.organizeFile()`
- A cada task concluída, persiste o estado (para recovery em caso de crash)
- Se uma task falha, marca como `failed` e continua (não bloqueia a fila)
- Ao final, tasks `done` são removidas; `failed` permanecem para retry

### 3. NFO Generator (`src/services/organizer/nfo-generator.ts`)

Geração de arquivos `.nfo` no formato compatível com Kodi.

```typescript
function generateArtistNfo(params: {
  name: string;
  biography?: string;
  genres?: string[];
  country?: string;
  type?: string;
  mbid?: string;
}): string  // XML string

function generateAlbumNfo(params: {
  title: string;
  artist: string;
  year?: number;
  genres?: string[];
  mbid?: string;
  tracks: { title: string; trackNumber?: number; duration?: number }[];
}): string  // XML string
```

**Formato artist.nfo:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<artist>
  <name>Sevendust</name>
  <musicBrainzArtistID>...</musicBrainzArtistID>
  <genre>Alternative Metal</genre>
  <biography>...</biography>
</artist>
```

**Formato album.nfo:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<album>
  <title>Black Out the Sun</title>
  <artist>Sevendust</artist>
  <year>2013</year>
  <genre>Alternative Metal</genre>
  <track>
    <title>Memory</title>
    <tracknum>1</tracknum>
  </track>
  ...
</album>
```

Criados **se não existirem** no diretório de destino (nunca sobrescrever).

### 4. Cover Extractor (`src/services/organizer/cover-extractor.ts`)

Extrai embedded cover art e salva como `cover.jpg` no diretório do álbum.

```typescript
async function extractCoverToAlbumDir(
  libraryRoot: string,
  targetAlbumDir: string,
  pictureData: { data: number[]; format: string } | null,
  coverRelPath: string | null,   // do sqliteDb se já foi salvo
): Promise<string | null>
```

**Fluxo:**

1. Se `pictureData` está disponível (acabou de ser extraído do arquivo):
   - Salvar como `{targetAlbumDir}/cover.jpg`
   - Se a image é PNG, converter para JPG via Canvas (futuro)
   - Retornar path relativo
2. Se `coverRelPath` do sqliteDb está disponível (já salvo pelo scanner):
   - Copiar (read + write) de `sqlite-db/images/album/{hash}.{ext}` para `{targetAlbumDir}/cover.jpg`
   - Retornar path relativo

### 5. Sanitizer (`src/services/organizer/sanitizer.ts`)

```typescript
// Reutiliza o padrão existente em image-preloader.ts
export function sanitizeForPath(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim();
}
```

Limitado a 200 caracteres por componente para evitar problemas de filesystem.

## Integração com o Scanner

### Mudanças em `local-indexer.ts`

**processFile()** — modificado para:

```typescript
async function processFile(filePath: string) {
  // ... extrair metadados (igual ao atual) ...

  // NOVO: enfileirar organização
  if (origin.organizeOnScan !== false) {
    orgQueue.enqueue({
      id: fileIdFromPath(filePath),
      sourcePath: filePath,
      artistName,
      albumName,
      releaseYear: meta?.year,
      trackNumber: meta?.trackNumber,
      discNumber: meta?.discNumber,
      trackTitle: trackName,
      extension: filePath.slice(filePath.lastIndexOf(".")),
    });
  }

  // ... acumular em pendingAlbums (igual ao atual) ...
}
```

**run()** — modificado para executar organização após processar todos os arquivos:

```typescript
async function run() {
  // ... processBatch igual ao atual ...

  if (scannedCount >= totalDiscovered) {
    // NOVO: processar fila de organização antes de finish()
    if (origin.organizeOnScan !== false) {
      await processOrganizationQueue();
    }
    await finish();
  }
}

async function processOrganizationQueue() {
  publishStatus("Organizando arquivos\u2026", "info");
  setState({ progress: { currentItem: "Organizing files\u2026" } });

  const organizer = createFileOrganizer(libraryRoot);
  const results = await orgQueue.processAll(organizer);

  // Atualizar paths nos pendingAlbums
  for (const result of results) {
    if (result.skipped || !result.targetPath) continue;
    // Atualizar track.path nos pendingAlbums
    // result.targetAlbumDir + fileName = novo relPath
    updatePendingAlbumPaths(result);
  }

  const failed = results.filter((r) => r.status === "failed");
  if (failed.length > 0) {
    publishStatus(`${failed.length} arquivo(s) não puderam ser organizados`, "warn");
  }

  orgQueue.clear();
}
```

### Mudanças em `local-controller.ts`

**getStreamUrl()** — atualmente constrói path como:

```
`${root}/${meta.artistName}/${meta.name}/${track.path}`
```

Após organização, `track.path` será um path relativo completo (ex: `Sevendust/Black Out the Sun (2013)/Sevendust - Black Out the Sun - 01 - Memory.mp3`).

Mudar `getStreamUrl` para usar `track.path` diretamente:

```typescript
getStreamUrl: async (songId) => {
  // ... lookup track ...
  if (!track.path) return null;
  // track.path agora é "artist/album (year)/file.mp3"
  // (relativo ao libraryRoot, não mais só filename)
  const fullPath = `${root}/${track.path}`;
  const data = await p.readFile(fullPath);
  // ...
}
```

Isso exige migração de dados: em tracks existentes que **não** foram organizadas, `track.path` continua sendo só o filename relativo ao album dir. Portanto `getStreamUrl` deve tentar ambos os patterns:

```typescript
// Tentar novo pattern (path completo relativo)
const fullPath = `${root}/${track.path}`;
let data = await p.readFile(fullPath);
if (!data) {
  // Fallback: pattern antigo (album dir + filename)
  const oldPath = `${root}/${meta.artistName}/${meta.name}/${track.path}`;
  data = await p.readFile(oldPath);
}
```

### Mudanças no `Origin.type`

Adicionar campo `organizeOnScan`:

```typescript
export type Origin = {
  id: string;
  name: string;
  type: OriginType;
  folderPath?: string;
  downloadFolder?: string;
  enableOnlineSearch?: boolean;
  musicBrainzToken?: string;
  youtubeMusicHeaders?: string;
  organizeOnScan?: boolean;   // NOVO: default true
  organizeDryRun?: boolean;   // NOVO: se true, só mostra o que faria
};
```

### Mudanças no `_meta` / schema

Schema version bump para 3 com nova coluna:

```sql
-- track.path passa a ser path relativo completo ao libraryRoot
-- tracks existentes precisam ser migradas OU o getStreamUrl
-- faz fallback como descrito acima.
```

Não é necessário alterar schema — o fallback bidirecional é suficiente. Apenas tracks novas (organizadas) terão path completo relativo.

## Fluxo Detalhado

### Scan completo (primeira vez)

```
1. acquireScanLock
2. initDatabase
3. discoverAndEnqueue → totalDiscovered = N
4. Para cada lote de 5 arquivos:
   a. processFile(filePath)
      - readFile → parseBuffer (music-metadata)
      - extrair: artist, album, year, track#, title
      - acumular em pendingAlbums (path antigo)
      - enqueue OrgTask se organizeOnScan
   b. atualizar progresso
5. Se organizeOnScan:
   a. publishStatus("Organizing files...")
   b. orgQueue.processAll()
      Para cada task:
      - buildTargetPath() → /Artist/Album (YYYY)/Artist - Album - NN - Title.mp3
      - ensureDirectories()
      - rename file
      - move .lrc se existir
      - extract cover.jpg
      - write album.nfo se não existir
      - write artist.nfo se não existir
      - atualizar track.path nos pendingAlbums
   c. orgQueue.clear()
6. finish()
   a. beginTransaction()
   b. upsertAlbums (com paths atualizados)
   c. upsertArtists
   d. commit
   e. setConfig(songCount, etc.)
   f. flushSave()
   g. releaseScanLock
```

### Scan incremental

```
1. Walk filesystem, comparar com processedPaths in-memory
2. Apenas arquivos novos entram no fluxo
3. Mesmo pipeline: processFile → enqueue → organize → finish
```

### Fallback se organização falhar

Se `rename` falhar (ex: cross-device), tentar:
```
1. readFile(source) → Uint8Array
2. writeFile(target) 
3. deleteFile(source)
```

Se tudo falhar, marcar task como `failed` e continuar. O arquivo original permanece intacto.

## Tratamento de Erros

| Cenário | Comportamento |
|---------|---------------|
| Target já existe | Skip, log warn, marca como skipped |
| Cross-device rename | Fallback: copy + delete |
| Permissão negada | Marca como failed, continua |
| Disco cheio | Marca como failed, aborta fila |
| Source não encontrado | Marca como failed (source foi deletado entre discovery e organização) |
| NFO já existe | Não sobrescrever |
| Crash durante organização | Recupera da fila persistida no próximo scan |

## Arquivos a Criar

| Arquivo | Descrição |
|---------|-----------|
| `src/services/organizer/file-organizer.ts` | Lógica central de organização |
| `src/services/organizer/organization-queue.ts` | Fila persistente de tarefas |
| `src/services/organizer/nfo-generator.ts` | Geração de .nfo (XML) |
| `src/services/organizer/cover-extractor.ts` | Extração de cover → cover.jpg |
| `src/services/organizer/sanitizer.ts` | Sanitização de paths |
| `src/services/organizer/index.ts` | Barrel export |

## Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `src/types/domain-types.ts` | Adicionar `organizeOnScan` e `organizeDryRun` em `Origin` |
| `src/api/indexer/local-indexer.ts` | Integrar OrganizationQueue + FileOrganizer no pipeline |
| `src/api/local/local-controller.ts` | `getStreamUrl()` com fallback bidirecional de path |
| `src/stores/auth.store.ts` | Preservar `organizeOnScan` na migração |

## Configuração

Settings → Origins → Editar `organizeOnScan` (toggle).

No arquivo de settings da origin (auth.store), o usuário pode desabilitar:

```json
{
  "id": "local-1",
  "name": "My Music",
  "type": "local",
  "folderPath": "/home/user/Music",
  "organizeOnScan": true,
  "organizeDryRun": false
}
```

O modo `dryRun` apenas loga o que faria (console.warn + status messages) sem executar movimentações.

## Edge Cases

### 1. Álbuns com discos múltiplos

```
Disc 1: Sevendust - Black Out the Sun - 01 - Memory.mp3
Disc 2: Sevendust - Black Out the Sun - 201 - Until Then.mp3
```

Mantido no mesmo diretório, `discNumber` prefixa o track number com `{disc}{track}`. Se discNumber > 1, formato: `01-01`, `01-02`, ..., `02-01`.

### 2. Álbuns de compilação (vários artistas)

Se `albumArtist` difere de `artist`, manter no diretório do `albumArtist`:

```
/Now That's What I Call Music (2020)/
  Now That's What I Call Music - 2020 - 01 - Song Name.mp3
```

### 3. Arquivos sem metadados

Usar nomes derivados de diretório (fallback) — mesmo comportamento do scanner atual.

### 4. Música já organizada

Se `sourcePath === targetPath`, skip. Detectado por comparação de paths normalizados.

### 5. Caracteres especiais em nomes

Sanitizar: `\/?%*:|"<>` → `_`. Limite de 200 chars por componente.

### 6. Arquivos .lrc órfãos

Se um `.lrc` existe sem áudio correspondente, não mover. Se o áudio foi movido e o `.lrc` está no mesmo diretório, mover junto.

### 7. Organização parcial

Se o scan for abortado (pause/abort), a fila persistida permite retomar. No próximo `start()`, carregar fila pendente e processar antes de novo discovery.

## Performance

| Operação | Custo esperado |
|----------|----------------|
| buildTargetPath() | O(1) — string concat |
| ensureDirectories() | O(d) — d = profundidade |
| rename (mesmo device) | O(1) — metadados de FS |
| rename (cross-device) | O(n) — n = tamanho do arquivo |
| writeNfo() | O(t) — t = tracks |
| extractCover() | O(1) — write de blob |
| Queue persist | O(q) — q = tasks pendentes |

### Impacto no tempo de scan

Para 1000 músicas (~400 MB) no mesmo device:
- Discovery: ~2s
- Metadata extraction: ~30s (300ms por música via IPC)
- Organization: ~5s (rename é instantâneo no mesmo device)
- Total: ~37s (vs ~32s sem organização)

## Compatibilidade com Download Queue

A Download Queue (`specs/download-queue.md`) já salva arquivos na estrutura padronizada. O File Organizer usa a mesma lógica de `buildTargetPath()` para consistência — ambos devem compartilhar o sanitizer.

Quando a download queue coloca um arquivo em:
```
/downloads/Sevendust/Black Out the Sun (2013)/Sevendust - Black Out the Sun - 01 - Memory.mp3
```

O scanner detectará que este arquivo já está na estrutura correta e pulará (sourcePath === targetPath).
