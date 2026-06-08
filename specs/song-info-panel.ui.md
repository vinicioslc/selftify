# Song Info Panel — UX/UI

## Visão Geral

Painel lateral / modal que centraliza todos os dados persistidos de uma música do MusicBrainz:
imagens baixadas (álbum + artista), candidatos do YouTube com ranking, e seleção ativa.
Acessado via menu de contexto (clique direito) em qualquer resultado de busca MusicBrainz.

---

## Gatilho de Abertura

### Context Menu (desktop)

- **Clicar com o direito** em qualquer linha de música nos resultados MusicBrainz
- Menu de contexto flutuante com uma opção: **"🔍 Song Info"**
- Posicionado ao lado do cursor (não cobre o item clicado)

### Teclado (acessibilidade)

- `Shift+F10` ou `Menu` key no item selecionado → mesmo context menu
- `Enter` no item com foco → abre direto (sem menu)

---

## Layout do Painel

### Dimensões e Posição

| Tamanho de tela | Comportamento |
|----------------|---------------|
| `>= lg` (1024px) | Painel lateral direito, 400px de largura, ocupando altura total da viewport |
| `< lg` (mobile) | Modal full-screen com overlay escuro, barra de fechar no topo |

### Estrutura (top → bottom) — Shared Component `SongInfoContent`

```
┌─────────────────────────────────────┐
│ ┌───────────┐  ┌───────────┐       │
│ │  Cover    │  │  Artist   │       │  ← Imagens (album + artista)
│ │  120x120  │  │  80x80    │       │     SEMPRE visíveis
│ └───────────┘  └───────────┘       │
│  Album Name      Artist Name       │
├─────────────────────────────────────┤
│ Song Metadata + MusicBrainz IDs     │  ← SEMPRE visível
│ Title, Artist, Album, Duration,     │
│ Year, Track, Genres                 │
├─────────────────────────────────────┤
│ ┌─────────┬─────────┬──────────┐   │
│ │ Sources │ Covers  │ Origins* │   │  ← Tabs (shadcn)
│ └─────────┴─────────┴──────────┘   │  * Origins aparece apenas se
├─────────────────────────────────────┤    houver origins configuradas
│ (Tab content below)                 │
│                                     │
│ ── Sources Tab ──                    │
│ ┌─────────────────────────────────┐ │
│ │ Current Selection               │ │  ← Card destacado com badge
│ │ 🎵 Video Title              ▶  │ │     Auto/Manual/Custom
│ │    Uploader · Score: 2.50      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ YouTube Candidates (N)  [Re-rank]   │
│ ○ Video #1          2.50  🥇 T A D│
│ ○ Video #2          1.80  🥈 T A  │
│ ⊕ Video #3          1.20  🥉 Al D │
│   ...                              │
│                                     │
│ Local candidates (N)                │
│ ● song.mp3          320kbps  12MB  │
│ ○ song2.flac        24-bit   45MB  │
│                                     │
│ Custom YouTube URL                  │
│ ┌──────────────────────┬───────┐   │
│ │ https://youtube...   │ Fetch │   │
│ └──────────────────────┴───────┘   │
├─────────────────────────────────────┤
│ ── Covers Tab ──                    │
│ Provider A  [Search]               │
│ [thumb1] [thumb2] [thumb3]         │
│ Provider B  [Search]               │
│ [thumb1] [thumb2]                   │
├─────────────────────────────────────┤
│ ── Origins Tab ──                   │
│ Origin 1  [Search YouTube]         │
│ Origin 2  [Search YouTube]         │
└─────────────────────────────────────┘
```

---

## Seções Detalhadas

### 1. Header

- Nome da música com truncamento (`truncate` Tailwind)
- Ao lado: botão `✕` (fechar) sempre visível
- Em mobile: barra fixa no topo com `✕` e nome
- Tooltip no nome: nome completo + artista

### 2. Imagens

| Imagem | Tamanho | Fonte | Fallback |
|--------|---------|-------|----------|
| Cover (álbum) | 120×120px, rounded-lg | `song.imageUrl` ou CoverArtArchive | `<SongEmptySvg />` |
| Artista | 80×80px, rounded-full | IndexedDB ou Wikidata/Wikipedia | `<ArtistEmptySvg />` |

- Se a imagem não estiver em cache, mostra **skeleton** (shimmer animation, 0.5s delay)
- Abaixo de cada imagem: label em `text-xs text-muted-foreground`
- Ao clicar na imagem do artista → navega para página do artista

### 3. Current Selection

Card destacado com `bg-accent/30 border border-accent`:

```
┌─────────────────────────────────────┐
│ 🎵 Video Title                     │
│    Uploader · Score: 2.50          │
│    🔘 Auto-selected     [Open ▶]  │  ← Badge + link YouTube
└─────────────────────────────────────┘
```

- **Badge**: "Auto-selected" (amarelo) ou "Custom" (verde)
- **"Open ▶"**: Abre `https://youtube.com/watch?v={videoId}` em nova aba
- **Score**: `tabular-nums` alinhado à direita
- Se não houver seleção: "No video selected. Choose from candidates below or add a custom URL."

### 4. YouTube Candidates List

Lista vertical com scroll (`max-h-80 overflow-y-auto`):

Cada linha (com duração e tooltips):
```
○ Video Title         3:45  2.50  
   Uploader    T A Al Ch D ~D  🥇
```

| Elemento | Props |
|----------|-------|
| Radio button | `h-4 w-4 accent-primary`, `cursor-pointer` |
| Título | `text-sm font-medium truncate flex-1`, `title` attr com nome completo |
| Score | `text-xs tabular-nums text-muted-foreground shrink-0` |
| Uploader | `text-xs text-muted-foreground truncate max-w-[150px]` |
| Breakdown | `flex gap-1.5 text-[10px] font-bold` |
| Medalha | Apenas top 3: `🥇🥈🥉` |

Cada indicador tem um `title` (tooltip) mostrando o nome completo: "Title match", "Artist match", "Album match", "Artist on channel", "Exact duration", "Closest duration".

Breakdown icons (coloridos):

| Icon | Significado | Cor |
|------|------------|-----|
| T | Title match | `text-green-500` |
| A | Artist match | `text-blue-500` |
| Al | Album match | `text-amber-500` |
| Ch | Artist on channel | `text-orange-500` |
| D | Exact duration | `text-purple-500` |
| ~D | Closest duration | `text-purple-400` |

- **Hover**: `bg-accent/50`
- **Selected row**: `bg-accent/30` + radio checked
- **Click na linha**: seleciona o radio button
- **Transição**: `transition-colors duration-150`

### 5. Custom URL Input

```
┌─────────────────────────┬──────┐
│ https://youtube.com/... │ Fetch│
└─────────────────────────┴──────┘
```

| State | Input | Botão |
|-------|-------|-------|
| Idle | `text-sm` placeholder "Paste a YouTube link..." | "Fetch" outline |
| Valid URL | Borda `border-green-500` | "Fetch" primary |
| Invalid URL | Borda `border-destructive` | Disabled |
| Fetching | Disabled | `<Loader2 className="animate-spin" /> Fetching...` |
| Success | Limpo | "✓ Fetched" (2s, depois volta) |
| Error | Borda `border-destructive` | "Retry" |

Validação de URL: aceita:
- `https://youtube.com/watch?v={id}`
- `https://youtu.be/{id}`
- `https://www.youtube.com/watch?v={id}`
- `{id}` (apenas o videoId, 11 caracteres)

Ao colar um link válido:
1. Sistema faz fetch dos metadados do vídeo (via `yt:search` com o videoId ou via `yt-dlp` extract)
2. Se sucesso: adiciona como candidato, seleciona automaticamente, badge "Custom"
3. Se falha: mostra erro, input mantém o link

### 6. Save Button

Botão primário no final do painel:
- **Disabled** (cinza): se nenhuma alteração foi feita
- **Enabled** (primary): se o usuário mudou a seleção
- **Saving**: `<Loader2 />` + "Saving..."
- **Saved**: "✓ Saved" (2s, depois volta)

---

## Estados

### Loading (esqueleto)

```
┌─────────────────────────────────────┐
│ ███████████████████████████████████  │
├─────────────────────────────────────┤
│ ░░░░░░░░  ░░░░░░                    │
│  ░░░░░░░  ░░░░░                     │
├─────────────────────────────────────┤
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└─────────────────────────────────────┘
```

- Skeleton via componente shadcn (ou divs com `animate-pulse bg-muted`)
- 3 linhas de skeleton para a lista de candidatos

### Empty (sem dados)

```
┌─────────────────────────────────────┐
│                                     │
│            🔍 No Data               │
│                                     │
│  No ranking data found for this     │
│  song. Play it first to generate    │
│  YouTube matches.                   │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  Play Song to generate     │    │
│  └─────────────────────────────┘    │
│                                     │
└─────────────────────────────────────┘
```

- `py-16` de padding
- Ícone centralizado (Search ou FileQuestion do Lucide)
- Botão "Play Song to generate" opcional

### Error

```
┌─────────────────────────────────────┐
│  ⚠ Could not load song data        │
│  [Retry]                            │
└─────────────────────────────────────┘
```

- Banner vermelho no topo do conteúdo
- Botão "Retry" recarrega

---

## Animações

| Elemento | Animação | Timing |
|----------|----------|--------|
| Abertura do painel | Slide-in da direita (lateral) OU fade-in + scale (modal) | 200ms ease-out |
| Fechamento | Slide-out para direita OU fade-out | 150ms ease-in |
| Check de radio | Transição suave do círculo interno | 100ms |
| Custom URL fetch | Loader girando no botão | até completar |
| Save | Checkmark verde fade-in | 300ms |
| Skeleton | Shimmer (pulse) | 1.5s loop |

---

## Responsivo

### Desktop (>= lg)
- Painel lateral direito, 400px fixo, altura 100vh
- Conteúdo principal encolhe (sem scroll do layout)
- Overlay semi-transparente na lateral esquerda?

### Mobile (< lg)
- Modal full-screen com `z-50`
- Overlay escuro atrás (70% opacity)
- Barra fixa no topo: `✕` esquerda, nome centralizado
- Scroll do conteúdo
- Fechar = swipe down? (nice-to-have)

---

## Acessibilidade

- **Focus trap**: Tab循环 dentro do painel quando aberto
- **Escape**: Fecha o painel
- **ARIA**: `role="dialog"`, `aria-modal="true"`, `aria-label="Song Info"`
- **Radio group**: `role="radiogroup"` na lista de candidatos, cada item `role="radio"`
- **Keyboard**: Setas ↑↓ navegam entre candidatos, Enter seleciona
- **Focus inicial**: Primeiro radio button ou Custom URL input
- **Focus ao fechar**: Volta para o item de música que abriu

---

## Variantes de Tema

Todas as cores usam variáveis CSS do Tailwind/shadcn:
- `bg-background`, `bg-accent`, `bg-muted`, `text-foreground`, `text-muted-foreground`
- `border-border`, `border-accent`
- SVGs de fallback usam `#888` (cinza neutro, funciona em claro/escuro)
- Breakdown icons usam cores fixas (green-500, blue-500, etc.) mas têm bom contraste em ambos os temas

---

## User Flow

```
1. Usuario pesquisa "trapt headstrong" no MusicBrainz
2. Resultados aparecem (songs + albums + artists)
3. Usuario CLICA DIREITO na musica "Headstrong"
4. Context menu aparece: "🔍 Song Info"
5. Clica → Painel abre com dados carregados
6. Ve:
   - Cover do album (se existir)
   - Imagem do artista (Trapt - via Wikidata)
   - Ranking do YouTube com 20 candidatos
   - Video selecionado: "Trapt - Headstrong (Official Video)"
   - Score: 2.50 (T + A + D)
7. Usuario clica em outro candidato → radio muda
8. Clica "Save Selection" → "✓ Saved"
9. Fecha o painel → proximo play usa o video selecionado

--- OU ---

1. Usuario abre "Song Info" para musica sem ranking
2. Ve tela vazia com "No ranking data found"
3. Clica "Play Song to generate" → sistema busca, gera ranking
4. Painel recarrega com candidatos
5. Usuario escolhe um → Save
```

---

## Integrações Existentes

### Comportamento de Play

Quando o usuário clica "Play" na música:
1. Verifica se há `customVideoId` salvo no `mbz_yt_mapping`
2. Se sim: usa esse videoId diretamente (pula ranking)
3. Se não: comportamento normal (auto-ranking)

Isso já está implementado no `youtube-download-service.ts` via `getStreamUrl(song, manualVideoId)`.

### Onde os dados ficam

```ts
// mbz_yt_mapping table (IndexedDB) — expandido:
mbzRecordingId: string  // PK
selectedVideoId: string // videoId atualmente selecionado (pode vir do ranking ou custom)
selectedType: "auto" | "manual" | "custom"  // como foi selecionado
customVideoId?: string   // se foi URL custom colada
candidates: string       // JSON-stringified YoutubeSearchScoredVideo[]
songName: string
artistName: string
albumName?: string
createdAt: number
updatedAt: number
```

### 7. Cover Providers Tab

A seção de covers foi movida para a aba **Covers** do componente `SongInfoContent`.

Os providers de capa são exibidos com thumbnails e botões de ação:

```
┌────────────────────────────────────────────┐
│ Covers Tab                                 │
├────────────────────────────────────────────┤
│ Providers                   (2 found / 5)    │  ← Contagem
│ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│ │ Provider │ │ Provider │ │ Provider │     │
│ │  A       │ │  B       │ │  C       │     │
│ │ ┌──────┐ │ │ ┌──────┐ │ │ ┌──────┐ │     │
│ │ │ cover│ │ │ │ cover│ │ │ │      │ │     │
│ │ └──────┘ │ │ └──────┘ │ │ └──────┘ │     │
│ │ ✓ Active │ │ [Select] │ │ [Fetch]  │     │  ← Estado por card
│ └──────────┘ └──────────┘ └──────────┘     │
│ ┌──────────┐ ┌──────────┐                   │
│ │ Provider │ │ Provider │                   │
│ │  D       │ │  E       │                   │
│ │ ┌──────┐ │ │ ┌──────┐ │                   │
│ │ │      │ │ │ │      │ │                   │
│ │ └──────┘ │ │ └──────┘ │                   │
│ │ [Fetch]  │ │ [Fetch]  │                   │
│ └──────────┘ └──────────┘                   │
└────────────────────────────────────────────┘
```

#### Estados por Provider Card

| Estado | Thumbnail | Badge | Ação |
|--------|-----------|-------|------|
| **Not fetched** | Placeholder (avatar fallback) | — | "Fetch" outline button |
| **Fetching** | Skeleton pulse | — | "Fetching..." disabled |
| **Found** | Cover thumbnail (48x48 rounded) | Provider name | "Select" outline button |
| **Active** | Cover thumbnail (48x48 rounded) | "✓ Active" | Disabled, destaque verde |
| **Not found** | Placeholder (avatar fallback) | "Not found" | "Retry" ghost button |
| **Error** | Placeholder (broken image) | — | "Retry" destructive |

#### Provider Card Layout

```
┌──────────────────┐
│   ┌────────────┐ │
│   │  Thumbnail │ │  48×48px, rounded-md
│   │  48×48     │ │
│   └────────────┘ │
│   Provider Name  │  text-xs text-muted-foreground
│   [Select]       │  h-7 text-[10px] button
└──────────────────┘
```

Cards em grid: `grid grid-cols-3 gap-2` em desktop, `grid-cols-2` em mobile.

#### "Fetch all" Button

- No cabeçalho da seção, alinhado à direita
- Estado: "Fetch all" → "Fetching (2/5)..." → "Fetched ✓"
- Chama `artworkResolver.resolveAll()` com os dados da música
- Desabilita botões individuais durante fetch

#### Cover Selection Flow

1. Usuário clica "Fetch" em um provider → chama `artworkProvider.search()`
2. Provider retorna candidatos → thumbnail é exibida
3. Usuário clica "Select" → a capa é baixada e armazenada no image-store
4. A thumbnail selecionada recebe badge "✓ Active"
5. O cover exibido no topo da seção (Current) também é atualizado

#### Providências Técnicas (visíveis na UI)

- Ao selecionar uma capa, o sistema:
  1. Faz download da imagem via `fetchImageAsBlobUrl()`
  2. Converte para `ArrayBuffer` e computa SHA-256 hash
  3. Armazena no IndexedDB via `storeImage()` com metadados da música
  4. Dispara `emitCoverUpdate()` que notifica `useCover` hook
  5. Atualiza a UI local imediatamente

---

## Non-Goals (escopo desta spec)

- Não inclui edição de metadados da música
- Não inclui busca manual no YouTube dentro do painel (só colar URL)
- Não inclui preview de áudio dos candidatos
- Não inclui arrastar candidatos para reordenar
