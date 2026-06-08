# UX/UI Spec: Artwork Resolver Settings

> **Status**: draft
> **Last update**: 2026-06-04
> **Tipos**: `ArtworkProvider`, `ArtworkProviderSetting` — ver `artwork-resolver.md:2`
> **Eventos**: `settings:changed` — ver `event-hooks.md:2`

## Visão Geral

A aba de configuração "Artwork" na página de Settings permite ao usuário ativar/desativar cada provider de capa individualmente e ajustar o rate limit (pace) entre requests para controlar o consumo de APIs externas.

---

## 1. Layout — Aba "Artwork"

```
┌────────────────────────────────────────────────────────┐
│  Artwork Providers                                     │
│                                                        │
│  Controle quais serviços de busca de capa estão         │
│  ativos e a velocidade de consulta.                      │
│                                                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │  ☑ Embedded Tags            ██████░░░░   —        │ │
│  │  Capa extraída do arquivo                          │ │
│  │  (local, sem limite de taxa)                       │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  ☑ Cover Art Archive         ██░░░░░░░░  200ms    │ │
│  │  Capas oficiais por MBID                           │ │
│  │  coverartarchive.org                                │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  ☑ MusicBrainz RG            █████░░░░░  1000ms   │ │
│  │  Release group → releases → CAA                    │ │
│  │  musicbrainz.org                                    │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  ☐ iTunes Search             ██████░░░░  500ms    │ │
│  │  Apple Music / iTunes Store                        │ │
│  │  itunes.apple.com                                   │ │
│  ├────────────────────────────────────────────────────┤ │
│  │  ☐ Deezer                    ██████░░░░  500ms    │ │
│  │  Deezer album covers                              │ │
│  │  api.deezer.com                                     │ │
│  └────────────────────────────────────────────────────┘ │
│                                                        │
│  ⚠ Quanto menor o delay, mais rápido o resultado,       │
│  mas mais chamadas à API por segundo. APIs externas      │
│  podem bloquear excesso de tráfego.                      │
└────────────────────────────────────────────────────────┘
```

---

## 2. Componentes

### Provider Row

Cada provider é uma linha com:

```
┌──────────────────────────────────────────────────────────┐
│ ☑ Nome do Provider                     ████████░░ 200ms  │
│   Descrição curta                                         │
│   Domínio da API                                          │
└──────────────────────────────────────────────────────────┘
```

| Elemento | Tipo | Descrição |
|---|---|---|
| Checkbox `☑ / ☐` | Switch | Ativa/desativa o provider |
| Nome do provider | Texto bold | Nome amigável |
| Descrição | Texto pequeno cinza | Explica o que o provider faz |
| Domínio | Texto monoespaçado | URL base da API |
| Slider de pace | Slider horizontal | Delay entre requests |
| Valor do pace | Badge à direita | "200ms", "1s", "5s" |

### States do Switch

| Estado | Visual |
|---|---|
| Ativado (enabled = true) | Toggle azul à direita, texto normal |
| Desativado (enabled = false) | Toggle cinza à esquerda, texto com opacidade 50%, slider desabilitado |

### Slider de Pace

```
  100ms ●──────────────────────────── 10000ms
         ↑                                ↑
      rápido                          devagar
    (mais chamadas)              (menos chamadas)

Valor atual:  ████████░░  200ms
```

| Propriedade | Valor |
|---|---|
| Mínimo | 100 (100ms = 10 req/s) |
| Máximo | 10000 (10s = 0.1 req/s) |
| Step | 50ms |
| Valor padrão por provider | embed:0, caa:200, mb:1000, itunes:500, deezer:500 |

---

## 3. Estados Globais da Aba

### Nenhum provider ativo

```
┌──────────────────────────────────────────┐
│  Artwork Providers                        │
│                                          │
│  ⚠ Nenhum provider de capa ativo.       │
│  As músicas serão exibidas sem capa.     │
│  Ative pelo menos um provider acima.     │
└──────────────────────────────────────────┘
```

- Badge amarelo com warning
- Mensagem explicativa
- Placeholder de capa aparecerá em todas as músicas

### Todos providers ativos com pace baixo (potencialmente arriscado)

```
┌──────────────────────────────────────────┐
│  ⚠ Você tem múltiplos providers com      │
│  delay agressivo (<500ms). APIs externas  │
│  podem bloquear temporariamente.          │
└──────────────────────────────────────────┘
```

- Só aparece se ≥ 2 providers remotos com pace < 500ms
- Aviso informativo, não bloqueante

---

## 4. Informações de Rate Limit (tooltips)

Cada provider tem um ícone `ℹ` que ao hover mostra:

| Provider | Rate limit oficial | Recomendado |
|---|---|---|
| Cover Art Archive | Sem rate limit declarado | 200-500ms (boa prática) |
| MusicBrainz | 1 req/s por IP | 1000ms (obrigatório) |
| iTunes | Sem documentação oficial | 500ms |
| Deezer | 50 req / 5s por app | 500ms |

---

## 5. Persistência

As configurações são persistidas via `settings.store.ts` (Zustand persist com localStorage). Mudanças são aplicadas imediatamente — o próximo dispatch do `artworkQueue` já usa os novos valores.

Quando um provider é desativado, tasks já enfileiradas completam normalmente. Novas tasks não são aceitas para providers desativados.

---

## 6. Responsivo

| Breakpoint | Layout |
|---|---|
| ≥ 768px | Slider e badge lado a lado |
| < 768px | Slider ocupa linha inteira, badge abaixo |
