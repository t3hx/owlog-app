import { useEffect, useState } from 'react'

import type { CleReglage } from '@/ports/SettingsStore'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Lit un réglage et se recalcule quand il change.
 *
 * `useState` + `useEffect` plutôt que `useSyncExternalStore` : la lecture est
 * asynchrone, et `useSyncExternalStore` exige un instantané synchrone. Le
 * faire tenir demanderait un cache mémoire dans l'UI, c'est-à-dire une
 * seconde source de vérité pour la même donnée — précisément ce que
 * l'adaptateur refuse de faire.
 *
 * `chargement` est distinct de `valeur === undefined` : au premier rendu on
 * ne sait pas encore si le réglage existe. Confondre les deux ferait
 * clignoter l'écran de bienvenue à chaque ouverture, y compris pour
 * quelqu'un qui a déjà renseigné son prénom.
 */
export function useReglage(cle: CleReglage): {
  valeur: string | undefined
  chargement: boolean
} {
  const { settings } = usePorts()
  const [valeur, setValeur] = useState<string | undefined>(undefined)
  const [chargement, setChargement] = useState(true)

  useEffect(() => {
    let annule = false

    async function relire() {
      const lue = await settings.lire(cle)
      if (annule) return
      setValeur(lue)
      setChargement(false)
    }

    void relire()
    const desabonner = settings.souscrire(cle, () => void relire())

    return () => {
      annule = true
      desabonner()
    }
  }, [cle, settings])

  return { valeur, chargement }
}
