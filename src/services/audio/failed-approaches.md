# Failed Approaches — Áudio Bluetooth no Linux Desktop

Problema: música trava depois de ~2s, chiado/crackling, ou simplesmente não sai som
quando se usa fones Bluetooth no Linux Desktop (Tauri v2).

## 1. rodio + cpal (original)

**O que era:** Reprodutor de áudio via `rodio 0.19` (que embarca `cpal`).
O `RodioDevice` criava um `rodio::OutputStream` e um `rodio::Sink`.

**Por que falhou:**
- `cpal` não monitora hotplug de dispositivos de áudio no Linux.
- Quando o fone Bluetooth conecta/desconecta, o `OutputStream` continua apontando
  para o device antigo (ou um device zombie).
- O `Sink` tenta escrever, o buffer enche, o áudio para depois de ~2s.
- Se o device padrão muda enquanto o sink está rodando, `cpal` não renegocia —
  o resultado é crackling ou silêncio.
- `cpal` usa ALSA/PulseAudio por baixo e não tem suporte a `PipeWire` como
  backend nativo.

**Status:** ABANDONADO — cpal não é adequado para BT hotplug no Linux.

## 2. symphonia direto + pipewire crate (tentativa atual)

**O que era:** Decodificar com `symphonia 0.6` diretamente (sem rodio),
enviar PCM `f32` interleaved para o PipeWire via crate `pipewire 0.10`.
`PipeWireDevice` roda um `MainLoop` em thread separada, comunicação por
`pipewire::channel`.

**Por que pode falhar (hipóteses não verificadas):**
- A crate `pipewire` é uma binding Rust sobre `libpipewire-0.3`. Se o PipeWire
  do sistema estiver desatualizado ou mal configurado, a inicialização pode
  falhar silenciosamente.
- O `process` callback roda no contexto RT do PipeWire. Se o mutex do
  `RefCell` de contenção causar stalls, o PipeWire pode matar o callback.
- `Rc<RefCell<PwState>>` não é `Send`, mas está confinado a uma única thread.
  Isso é correto, mas qualquer movimento acidental para outra thread
  causaria UB (não detectado em compile-time).
- O `pipewire::channel` usa pipes Unix + `poll()`. Se o `MainLoop` estiver
  ocupado processando áudio, comandos podem sofrer latência.

**Status:** EM TESTE — compila, mas ainda não foi testado com BT.

## 3. stream proxy (não implementado)

**O que era (planejado para Fase 3):** Para origens Subsonic/Jellyfin, o Rust
baixa a URL do stream e serve para o frontend via proxy HTTP local.
O frontend toca com `<audio>` + `MediaElement` (Web API).

**Por que não resolve o BT:**
- O proxy só faz sentido para origens que o frontend precisa decodificar
  (Navidrome/Jellyfin). Para YT Music, a decodificação é no Rust.
- O BT continua sendo problema do backend de áudio (Rust), não do frontend.
- O `MediaElement` do navegador também sofre de problemas de latência e
  hotplug em alguns casos.

**Status:** NÃO IMPLEMENTADO — não ataca o problema de BT.

## 4. AudioContext + MediaElement (web) — apenas browser

**O que era:** `WebAudioProvider` que cria um `AudioContext` e conecta um
`MediaElement` como source. Usado quando `isTauri()` é falso (browser).

**Por que não ajuda no desktop:**
- Só funciona no browser. No Tauri desktop, não temos `AudioContext` com
  `MediaElement` funcionando de forma confiável.
- O WebView do Tauri pode ou não expor `AudioContext` dependendo da
  plataforma e configuração.
- Mesmo que funcionasse, sofreria dos mesmos problemas de device switching
  que o cpal.

**Status:** EXCLUSIVO PARA BROWSER — irrelevante para desktop+Tauri.

## Resumo

| Abordagem | Status | Motivo da falha |
|-----------|--------|-----------------|
| rodio + cpal | ❌ abandonado | cpal não gerencia hotplug BT no Linux |
| pipewire crate | 🔄 testando | compila, aguardando teste real com BT |
| stream proxy | ⏳ fase 3 | não ataca o problema de BT |
| Web Audio API | ✅ browser only | não se aplica ao Tauri desktop |

## Próximo passo se pipewire falhar

Se o `pipewire` crate não resolver, a alternativa é usar a biblioteca C do
PipeWire diretamente via `pipewire-sys` (sem a camada segura da crate),
controlando manualmente o `pw_thread_loop` e o `pw_stream` com chamadas FFI.
Isso daria controle total sobre o loop de eventos e evitaria qualquer
overhead da camada Rust.

Outra alternativa é abandonar a decodificação no Rust e fazer **streaming
por HTTP local** para todas as origens (incluindo YT Music), deixando o
decodificador nativo do sistema operacional (PipeWire via GStreamer ou
similar) tocar o arquivo. Isso terceiriza o problema de hotplug para o
PipeWire/GStreamer, que já lidam com BT corretamente.
