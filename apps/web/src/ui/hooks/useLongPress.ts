import { useCallback, useEffect, useRef } from 'react'

/**
 * Appui long.
 *
 * Le geste est délibérément coûteux : il sert à annuler une entrée de
 * journal, et un tap accidentel qui effacerait une ligne serait le pire
 * défaut possible sur un écran dont l'argument est de garder une trace.
 *
 * Il écoute le pointeur et non `touchstart` : `pointerdown` couvre le doigt,
 * la souris et le stylet d'un seul jeu d'événements, et le clic droit du
 * bureau tombe sur `contextmenu`, que le handoff donne comme équivalent.
 */
const HOLD_MS = 550

export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  // Un composant démonté pendant l'appui laisserait un timer qui écrit dans
  // un arbre disparu. Le cas arrive vraiment : annuler une entrée la retire
  // du journal, donc démonte la ligne qu'on est en train de presser.
  useEffect(() => clear, [clear])

  const start = useCallback(() => {
    fired.current = false
    clear()
    timer.current = window.setTimeout(() => {
      fired.current = true
      onLongPress()
    }, HOLD_MS)
  }, [clear, onLongPress])

  return {
    onPointerDown: start,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // Sans ça, un appui long sur mobile ouvre le menu de sélection natif
    // par-dessus l'action, et sur le bureau le clic droit fait double emploi.
    onContextMenu: (event: { preventDefault(): void }) => {
      event.preventDefault()
      if (!fired.current) onLongPress()
      clear()
    },
  }
}
