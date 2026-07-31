import { useCallback, useEffect, useRef, useState } from 'react'

import { log, type LogEntry, type StoredEvent } from '@owlog/domain'
import { usePorts } from '@/ui/PortsProvider'

/**
 * Nombre d'événements par page.
 *
 * Cinquante lignes mono remplissent plusieurs écrans de téléphone : la
 * première page suffit à répondre « qu'est-ce que j'ai fait ces temps-ci »,
 * qui est la question que l'écran sert.
 */
const PAGE = 50

/**
 * Flux du LOG global, paginé du plus récent au plus ancien.
 *
 * **Les annulations s'appliquent sur le cumulé, pas sur la page.** Un `VOID`
 * est toujours écrit après sa cible, donc il arrive toujours **avant** elle
 * dans un flux décroissant : filtrer page par page laisserait apparaître une
 * entrée annulée dès qu'elle tombe dans la page suivante. Le réducteur
 * repasse donc sur tout ce qui est chargé.
 *
 * Pas de lecture réactive ici, contrairement à l'accueil : `useLiveQuery`
 * rejouerait la requête entière à chaque écriture et ferait sauter la
 * pagination. L'écran se recharge à son ouverture, ce qui est le moment où
 * on le consulte.
 */
export function useLog() {
  const { events } = usePorts()
  const [entries, setEntries] = useState<readonly LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [exhausted, setExhausted] = useState(false)

  /** Événements bruts cumulés. Le réducteur les rejoue à chaque page. */
  const raw = useRef<StoredEvent[]>([])
  /** Identifiant le plus ancien reçu : c'est le curseur de la page suivante. */
  const cursor = useRef<string | null>(null)

  const loadMore = useCallback(async () => {
    setLoading(true)
    try {
      const page = await events.eventsRecent(cursor.current, PAGE)

      // Une page incomplète est la fin du flux. La détecter ici évite un
      // aller-retour de plus pour apprendre qu'il ne reste rien.
      if (page.length < PAGE) setExhausted(true)
      if (page.length === 0) return

      raw.current = [...raw.current, ...page]
      cursor.current = page[page.length - 1]?.id ?? cursor.current
      setEntries(log(raw.current))
    } finally {
      setLoading(false)
    }
  }, [events])

  /**
   * Une seule première page, quoi qu'il arrive.
   *
   * `loadMore` avance un curseur : le rejouer parce qu'une dépendance a
   * changé d'identité sauterait une page du flux. Le garde est un drapeau et
   * non une liste de dépendances vide, ce qui reste vrai même si les ports
   * changent d'instance.
   */
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void loadMore()
  }, [loadMore])

  return { entries, loading, exhausted, loadMore }
}
