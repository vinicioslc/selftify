/**
 * Feature flags para controle de correções e comportamentos.
 *
 * Útil para testes: ao desligar uma flag, é possível verificar
 * que o bug existe; ao ligar, atestar a correção.
 *
 * Uso:
 *   import { featureFlags } from "../../lib/feature-flags";
 *   if (featureFlags.FIX_DISMISSABLE_EVENTS_CLICK) { ... }
 *
 * Em testes:
 *   import { featureFlags } from "../../lib/feature-flags";
 *   featureFlags.FIX_DISMISSABLE_EVENTS_CLICK = false; // desliga o fix
 */

export const featureFlags = {
  /**
   * Quando true (padrão):
   * - Dialog wrapper restaura body.style.pointerEvents no onOpenChange
   * - DialogContent restaura no useEffect cleanup
   * - useElectronWindow restaura antes de fechar a janela
   *
   * Quando false: o bug do @radix-ui/react-dismissable-layer
   * que deixa pointer-events: none preso no body aparece.
   */
  FIX_DISMISSABLE_EVENTS_CLICK: true,
};
