import { useEffect, useState } from 'react'

import type { SettingKey } from '@/ports/SettingsStore'
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
 * `loading` est distinct de `value === undefined` : au premier rendu on
 * ne sait pas encore si le réglage existe. Confondre les deux ferait
 * clignoter l'écran de bienvenue à chaque ouverture, y compris pour
 * quelqu'un qui a déjà renseigné son prénom.
 */
export function useSetting(key: SettingKey): {
  value: string | undefined
  loading: boolean
} {
  const { settings } = usePorts()
  const [value, setValeur] = useState<string | undefined>(undefined)
  const [loading, setChargement] = useState(true)

  useEffect(() => {
    let voided = false

    async function reload() {
      const lue = await settings.read(key)
      if (voided) return
      setValeur(lue)
      setChargement(false)
    }

    void reload()
    const unsubscribe = settings.subscribe(key, () => void reload())

    return () => {
      voided = true
      unsubscribe()
    }
  }, [key, settings])

  return { value, loading }
}
