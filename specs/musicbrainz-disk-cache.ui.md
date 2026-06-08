# MusicBrainz Disk Cache — UX/UI

## Visão Geral

Nova seção na aba **Network** das configurações para controlar o TTL do cache em disco
dos metadados do MusicBrainz. Esta seção é adicional aos controles de timeout e cache já
existentes.

---

## Localização

Aba "Network" do Settings, após a seção "Clear Image Cache" (final do card):

```
Network Settings
┌─────────────────────────────────────────────┐
│  Network Settings                            │
│  ... (timeouts e cache existentes) ...      │
│                                             │
│  [Manage Cache]  [Clear Image Cache]        │
│                                             │
│  ──────────────────────────────────         │  ← Separator
│                                             │
│  MusicBrainz Disk Cache                     │  ← NOVA SEÇÃO
│  Armazena metadados em disco para           │
│  evitar re-consultar o MusicBrainz.         │
│                                             │
│  ○ 1 minute   ○ 15 minutes                  │
│  ○ 30 minutes  ○ Never expire               │
│                                             │
│  Location: <Library>/<Artist>/db.*.selftify │
│                                             │
│  [Clear Disk Cache Now]                     │
└─────────────────────────────────────────────┘
```

---

## Componentes

### Radio Group (TTL Selection)

Quatro opções mutuamente exclusivas, usando shadcn `RadioGroup` + `RadioGroupItem`:

| Opção | Value | Descrição |
|-------|-------|-----------|
| 1 minute | `"1min"` | Recarrega metadados a cada minuto |
| 15 minutes | `"15min"` | Recarrega a cada 15 minutos (padrão sensato) |
| 30 minutes | `"30min"` | Recarrega a cada 30 minutos |
| Never expire | `"never"` | Cache em disco é permanente; só atualiza com Clear |

**Layout**: `flex-col gap-2` com radio buttons em `flex items-center gap-2`.

### Location Info

Texto informativo não-interativo:

```
Location: <Library>/<Artist>/db.*.selftify
```

Usa `text-xs text-muted-foreground`. O placeholder `<Library>` representa o folderPath
da origin LOCAL; `<Artist>` é o nome do artista.

### Clear Disk Cache Button

Botão outline com ícone `Trash2`:

| State | Label | Behavior |
|-------|-------|----------|
| Idle | "Clear Disk Cache Now" | Reseta `musicbrainzDiskCacheVersion` no store |
| Clearing | "Clearing..." + Loader2 | Desabilitado durante a operação |
| Success | "✓ Cleared" (2s) | Feedback visual antes de voltar a idle |

Ao clicar, varre todos os `**/db.*.selftify` na library root e deleta.

---

## Textos

### Heading
```
MusicBrainz Disk Cache
```

### Description
```
Store MusicBrainz metadata on disk so it survives browser data clears.
Eliminates redundant HTTP requests to musicbrainz.org.
```

### Location text
```
Cache location: {libraryRoot}/{Artist}/db.{mbid}.selftify
```

### Clear button
```
[Clear Disk Cache Now]
```

---

## Estados

### Normal (configurado)
Radio button com a opção atual marcada.

### Sem library root
Se a origin atual não for LOCAL, a seção inteira é oculta (não há disco para cache).

```
(section not rendered)
```

### Limpando cache
```
[⏳ Clearing...]  ← botão disabled com Loader2
```

### Cache limpo
```
[✓ Cleared]  ← 2 segundos, depois volta a idle
```
