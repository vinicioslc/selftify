# YouTube Candidate Picker (MusicBrainz Results)

> **⚠ SUPERSEDED**: Esta spec descrevia um picker inline com linhas expandiveis na tabela
> de busca. A implementacao final substituiu esta abordagem por um modal dedicado
> (`SongInfoDialog`) que centraliza candidatos YouTube, covers, e metadados da musica.
> Veja `specs/song-info-panel.md`, `specs/song-info-panel.ui.md`, `specs/song-info-panel.api.md`
> para a documentacao atual.

## Problem

Quando o usuario da play em uma musica vinda do MusicBrainz, o sistema automaticamente
busca no YouTube e seleciona o melhor candidato via ranking. Nao ha visibilidade sobre
quais videos foram encontrados nem a possibilidade de escolher um candidato diferente
do selecionado automaticamente.

## Solution

Permitir que o usuario expanda cada linha de resultado MusicBrainz para ver a lista
de videos candidatos encontrados no YouTube, com informacoes de ranking (score,
breakdown), e selecionar manualmente qual video usar via radio button.

### Fluxo

```
Usuario clica no botao de expandir na linha
        │
        ▼
Sistema chama searchAndRankAll(song) → busca no YouTube + ranking
        │
        ▼
Sublista expande abaixo da linha mostrando todos os candidatos ranqueados
Cada candidato mostra:
  - Radio button (selecionado = melhor do ranking por default)
  - Titulo do video
  - Uploader
  - Score numerico
  - Breakdown icons (T, A, Al, D, ~D)
  - Duracao do video
        │
        ▼
Usuario pode clicar em outro radio button para selecionar manualmente
        │
        ▼
Usuario clica Play → usa o videoId selecionado (manual ou auto)
```

### Comportamento do Play

- Se o usuario selecionou manualmente um video → `getStreamUrl` usa esse videoId diretamente
- Se o usuario nao expandiu ou nao mudou a selecao → comportamento padrao (usa `selectedVideoId` salvo no `mbz_yt_mapping` ou auto-ranking se nao houver mapping)
- A selecao manual e **persistida no IndexedDB** (`mbz_yt_mapping.selectedVideoId` + `selectedType: "manual"`) para que plays futuros usem a mesma escolha
- Se o usuario expandir novamente, o radio button reflete a ultima selecao (do mapping salvo ou do estado local)

### Fallback

Se o usuario selecionar manualmente um video e o `getStreamUrl` falhar para esse videoId,
o sistema tenta o proximo candidato do ranking (fallback sequencial).

## Types

```typescript
// Novo type para candidato com selecao
type CandidateSelection = {
  songId: string;
  candidates: YoutubeSearchScoredVideo[];
  selectedVideoId: string | null; // null = usar auto-ranking
  loading: boolean;
};
```

## API Changes

### youtube-download-service.ts

Nova funcao `searchAndRankAll(song: Song): Promise<YoutubeSearchScoredVideo[] | null>`
- Igual a `searchAndRank` mas retorna todos os candidatos ranqueados
- Compartilha a logica de cache (mbz_yt_mapping) com `searchAndRank`
- Se houver cache hit, retorna array com um unico candidato (o cached)

### getStreamUrl

Nova assinatura opcional: `getStreamUrl(song: Song, videoId?: string): Promise<string | null>`
- Se `videoId` for fornecido, pula `searchAndRank` e vai direto para `api.yt.getStreamUrl(videoId)`
- Fallback: se falhar com o videoId fornecido, tenta `searchAndRank` normal

## UI Changes

### DataTable (data-table.tsx)

Novas props opcionais:
- `renderExpanded?: (item: T) => React.ReactNode` — renderiza sublinha expandida
- `expandedIds?: Set<string>` — IDs das linhas expandidas
- `onToggleExpand?: (id: string) => void` — callback para expandir/recolher

A sublinha aparece abaixo da linha normal, com indentacao e background diferente.

### SearchPage (search-page.tsx)

Novo state:
- `expandedCandidates: Map<string, CandidateSelection>`
- `expandedIds: Set<string>`

Nova coluna no `songColumns` (apenas para MB):
- `expand`: botao ChevronDown/ChevronRight que expande a linha

Novo componente inline para a sublinha expandida:
- Lista de candidatos com radio buttons
- Cada candidato mostra: titulo, uploader, score badge, breakdown icons
- Layout: grid alinhado com as colunas da tabela principal

### playMbz modificado

```typescript
async function playMbz(song: Song, manualVideoId?: string): Promise<string | null> {
  if (manualVideoId) {
    // Usa o videoId selecionado manualmente
    const url = await getStreamUrl(song, manualVideoId);
    if (url) return url;
    // Fallback: tenta auto-ranking
  }
  return getStreamUrl(song);
}
```

## Edge Cases

1. **Cache hit**: Se o mapping ja existe, mostrar apenas o candidato cached (ou fazer nova busca?)
   - Decisao: mostrar o cached + botao "Re-search" para forcar nova busca
2. **YouTube indisponivel**: Mostrar mensagem "YouTube search unavailable" na sublinha
3. **Zero resultados**: Mostrar "No YouTube matches found"
4. **Multiplos expands**: Apenas uma linha expandida por vez (accordion-like)
5. **Sorted data**: A expansao deve sobreviver a reordenacao da tabela

## Files Changed

| File | Change |
|------|--------|
| `specs/youtube-candidate-picker.md` | **Create** — this spec |
| `src/features/shared/data-table.tsx` | Modify — add expandable row support |
| `src/services/youtube-download-service.ts` | Modify — add `searchAndRankAll()`, optional `videoId` param in `getStreamUrl` |
| `src/features/search/search-page.tsx` | Modify — expand UI, candidate state, modified playback |
