# Song Info Panel

## Problem

Atualmente, quando o usuario da play em uma musica MusicBrainz, o sistema busca no YouTube,
ranqueia os candidatos e seleciona o melhor. O resultado (apenas o vencedor) e salvo no
`mbz_yt_mapping`. Contudo:

1. **Nao ha visibilidade** sobre quais candidatos foram encontrados ou como foram ranqueados
 2. **Nao ha como alterar** a escolha apos o ranking inicial
 5. **Artist on channel**: nao ha indicacao visual se o nome do artista aparece no nome do canal do YouTube
3. **Nao ha como usar** um video YouTube customizado (URL propria) para uma musica
4. **Dados de imagem** (capa do album, imagem do artista) ficam espalhados sem uma tela que
   os centralize por musica

## Solution

Criar um modal (`SongInfoDialog`) acessivel via menu de contexto (clique direito) ou
botao de acao em cada resultado de musica MusicBrainz, que centraliza:

- Imagens do album/song cover + artista
- Todos os candidatos do YouTube com ranking scores
- Video atualmente selecionado
- Input para colar URL customizada de video
- Capacidade de alterar a selecao e persistir no IndexedDB
- Indicador "Artist on channel" (Ch) no breakdown de scores dos candidatos

### Cache Behavior — "Select as Active"

Quando o usuario seleciona um candidato como ativo (radio button na lista de candidatos YouTube
ou na secao de URL customizada):

1. O `videoId` selecionado e salvo no `mbz_yt_mapping` (IndexedDB) via `setMbzYtMapping()`
2. O `selectedType` e definido como `"manual"` (candidato do ranking) ou `"custom"` (URL propria)
3. O `selectedVideoId` e persistido — plays futuros usarao esse videoId diretamente via `getStreamUrl(song)`,
   que verifica o mapping salvo antes de fazer auto-ranking
4. A selecao substitui qualquer selecao anterior (`"auto"` do ranking automatico ou `"manual"` anterior)

Isso garante que a escolha do usuario "atrela" a musica MusicBrainz ao video YouTube
especifico e sobrevive a restart do app (cache permanente ate o usuario limpar).

## Architecture — Shared Content + Tabs (v3)

A partir do refinamento "same tab sources", o Song Info foi refatorado para usar:

1. **Shared component (`SongInfoContent`)**: toda a lógica e UI do painel em um unico componente reutilizável
2. **Tabs (shadcn `Tabs`)**: em vez de seções colapsáveis, o conteúdo é organizado em abas
3. **Ambos Dialog e Popover usam o mesmo `SongInfoContent`** — apenas a casca externa difere

### Tab Structure

| Tab | Conteúdo |
|-----|----------|
| **Sources** | Current selection → YouTube candidates → Local candidates → Custom YouTube URL |
| **Covers** | Artwork providers (iTunes, Deezer, etc.) |
| **Origins** | Per-origin YouTube search (exibido apenas se houver origins configuradas) |

A seção de Images + Metadata permanece **sempre visível** acima das abas, em ambos Dialog e Popover.

### Files Changed (Atual)

| File | Change |
|------|--------|
| `specs/song-info-panel.ui.md` | **Modify** — update layout to tabs |
| `specs/song-info-panel.api.md` | **Create** — API/data contracts |
| `specs/song-info-panel.md` | **Create** — this spec |
| `src/features/song-info/song-info-content.tsx` | **Create** — shared content component with tabs |
| `src/features/song-info/song-info-dialog.tsx` | **Rewrite** — now wraps `SongInfoContent` in Dialog |
| `src/features/player/components/music-info-popover.tsx` | **Rewrite** — now wraps `SongInfoContent` in Popover |
| `src/services/search-cache.ts` | Modify — expand `mbz_yt_mapping` table schema |
| `src/services/youtube-ranking.ts` | Modify — export types for candidates |
| `src/services/youtube-download-service.ts` | Modify — save full candidate list on ranking, add `researchSong()` |

### Local Candidates — Extensão (v2)

A partir do spec `unified-stream-resolution.md`, o SongInfoContent também exibe:

- **Candidatos locais**: musicas no banco local que compartilham o mesmo `mbzRecordingId`
- Seção "Local candidates (N)" dentro da aba **Sources**, **abaixo** de "YouTube candidates (N)"
- Cada candidato local mostra: caminho do arquivo (truncado), bitrate, sample rate, file size
- O usuario pode selecionar um candidato local como fonte preferida
- A seleção persiste em `MbzYtMapping.selectedSource` e `localSongId`

| File | Change |
|------|--------|
| `src/features/song-info/song-info-content.tsx` | **Create** — add local candidates section within Sources tab |
| `src/services/search-cache.ts` | Modify — add `selectedSource`, `localSongId` to `MbzYtMapping` |
| `src/services/stream-resolver.ts` | **Create** — centralized `resolveSong()` |

### Cover Providers — Extensão

A partir desta spec, o Song Info também permite:

- Visualizar a capa atual do álbum
- Buscar capas de **todos os providers de artwork** suportados
- Exibir thumbnails de cada provider que retornou resultado
- **Selecionar** manualmente qual capa usar como cover da música
- A capa selecionada é armazenada no **image-store** (IndexedDB)

Os providers de capa estão na aba **Covers**.

| File | Change |
|------|--------|
| `src/features/song-info/song-info-content.tsx` | **Create** — add cover providers section within Covers tab |
| `src/services/artwork/artwork-resolver.ts` | Modify — add `resolveAll()` method |
